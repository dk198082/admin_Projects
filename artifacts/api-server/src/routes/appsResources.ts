import { Router, type IRouter } from "express";
import { eq, asc, and, ne, sql } from "drizzle-orm";
import {
  db,
  appsTable,
  resourcesTable,
  securityPoliciesTable,
  apiKeysTable,
} from "@workspace/db";
import {
  ListAppsResponse,
  ListResourcesQueryParams,
  ListResourcesResponse,
  CreateAppBody,
  CreateAppResponse,
  UpdateAppParams,
  UpdateAppBody,
  UpdateAppResponse,
  DeleteAppParams,
  CreateResourceBody,
  CreateResourceResponse,
  UpdateResourceParams,
  UpdateResourceBody,
  UpdateResourceResponse,
  DeleteResourceParams,
} from "@workspace/api-zod";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/apps", async (_req, res): Promise<void> => {
  const apps = await db.select().from(appsTable).orderBy(asc(appsTable.id));
  const resources = await db.select().from(resourcesTable);
  const result = apps.map((a) => ({
    ...a,
    resourceCount: resources.filter((r) => r.appId === a.id).length,
  }));
  res.json(ListAppsResponse.parse(result));
});

router.post("/apps", async (req, res): Promise<void> => {
  const parsed = CreateAppBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "App name is required" });
    return;
  }
  const [existing] = await db
    .select({ id: appsTable.id })
    .from(appsTable)
    .where(sql`lower(${appsTable.name}) = lower(${name})`);
  if (existing) {
    res.status(400).json({ error: `An app named "${name}" already exists` });
    return;
  }
  const created = await db.transaction(async (tx) => {
    const [app] = await tx.insert(appsTable).values({ name }).returning();
    await tx.insert(securityPoliciesTable).values({ appId: app.id });
    return app;
  });
  await logAudit(
    "create",
    "App",
    `Onboarded app ${name} with default security policy`,
    req.session.user?.name,
  );
  res.status(201).json(CreateAppResponse.parse({ ...created, resourceCount: 0 }));
});

router.patch("/apps/:id", async (req, res): Promise<void> => {
  const params = UpdateAppParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAppBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "App name is required" });
    return;
  }
  const [app] = await db.select().from(appsTable).where(eq(appsTable.id, params.data.id));
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  const [duplicate] = await db
    .select({ id: appsTable.id })
    .from(appsTable)
    .where(and(sql`lower(${appsTable.name}) = lower(${name})`, ne(appsTable.id, app.id)));
  if (duplicate) {
    res.status(400).json({ error: `An app named "${name}" already exists` });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(appsTable)
      .set({ name })
      .where(eq(appsTable.id, app.id))
      .returning();
    // api_keys reference apps by name — keep them in sync on rename
    await tx
      .update(apiKeysTable)
      .set({ appName: name })
      .where(eq(apiKeysTable.appName, app.name));
    return row;
  });
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(resourcesTable)
    .where(eq(resourcesTable.appId, app.id));
  if (app.name !== name) {
    await logAudit("update", "App", `Renamed app ${app.name} to ${name}`, req.session.user?.name);
  }
  res.json(UpdateAppResponse.parse({ ...updated, resourceCount: count }));
});

router.delete("/apps/:id", async (req, res): Promise<void> => {
  const params = DeleteAppParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [app] = await db.select().from(appsTable).where(eq(appsTable.id, params.data.id));
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }
  await db.transaction(async (tx) => {
    // resources, grants, and the security policy cascade via FKs; api_keys are linked by name
    await tx.delete(apiKeysTable).where(eq(apiKeysTable.appName, app.name));
    await tx.delete(appsTable).where(eq(appsTable.id, app.id));
  });
  await logAudit(
    "delete",
    "App",
    `Deleted app ${app.name} (including its resources, grants, security policy, and API keys)`,
    req.session.user?.name,
  );
  res.sendStatus(204);
});

function resourceSelect() {
  return db
    .select({
      id: resourcesTable.id,
      appId: resourcesTable.appId,
      appName: appsTable.name,
      name: resourcesTable.name,
      type: resourcesTable.type,
      description: resourcesTable.description,
    })
    .from(resourcesTable)
    .innerJoin(appsTable, eq(resourcesTable.appId, appsTable.id));
}

router.get("/resources", async (req, res): Promise<void> => {
  const query = ListResourcesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const base = resourceSelect().orderBy(
    asc(resourcesTable.appId),
    asc(resourcesTable.type),
    asc(resourcesTable.name),
  );
  const rows =
    query.data.appId !== undefined
      ? await base.where(eq(resourcesTable.appId, query.data.appId))
      : await base;
  res.json(ListResourcesResponse.parse(rows));
});

router.post("/resources", async (req, res): Promise<void> => {
  const parsed = CreateResourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Resource name is required" });
    return;
  }
  const [app] = await db.select().from(appsTable).where(eq(appsTable.id, parsed.data.appId));
  if (!app) {
    res.status(400).json({ error: "App not found" });
    return;
  }
  const [duplicate] = await db
    .select({ id: resourcesTable.id })
    .from(resourcesTable)
    .where(
      and(eq(resourcesTable.appId, app.id), sql`lower(${resourcesTable.name}) = lower(${name})`),
    );
  if (duplicate) {
    res.status(400).json({ error: `${app.name} already has a resource named "${name}"` });
    return;
  }
  const [created] = await db
    .insert(resourcesTable)
    .values({
      appId: app.id,
      name,
      type: parsed.data.type,
      description: parsed.data.description?.trim() ?? "",
    })
    .returning();
  await logAudit(
    "create",
    "Resource",
    `Added ${parsed.data.type} resource ${name} to ${app.name}`,
    req.session.user?.name,
  );
  const [row] = await resourceSelect().where(eq(resourcesTable.id, created.id));
  res.status(201).json(CreateResourceResponse.parse(row));
});

router.patch("/resources/:id", async (req, res): Promise<void> => {
  const params = UpdateResourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateResourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(resourcesTable)
    .where(eq(resourcesTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Resource not found" });
    return;
  }
  const updates: { name?: string; type?: string; description?: string } = {};
  if (parsed.data.name !== undefined) {
    const name = parsed.data.name.trim();
    if (!name) {
      res.status(400).json({ error: "Resource name is required" });
      return;
    }
    const [duplicate] = await db
      .select({ id: resourcesTable.id })
      .from(resourcesTable)
      .where(
        and(
          eq(resourcesTable.appId, existing.appId),
          sql`lower(${resourcesTable.name}) = lower(${name})`,
          ne(resourcesTable.id, existing.id),
        ),
      );
    if (duplicate) {
      res.status(400).json({ error: `This app already has a resource named "${name}"` });
      return;
    }
    updates.name = name;
  }
  if (parsed.data.type !== undefined) updates.type = parsed.data.type;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description.trim();
  if (Object.keys(updates).length > 0) {
    await db.update(resourcesTable).set(updates).where(eq(resourcesTable.id, existing.id));
    const [row] = await resourceSelect().where(eq(resourcesTable.id, existing.id));
    await logAudit(
      "update",
      "Resource",
      `Updated resource ${existing.name} in ${row.appName}`,
      req.session.user?.name,
    );
    res.json(UpdateResourceResponse.parse(row));
    return;
  }
  const [row] = await resourceSelect().where(eq(resourcesTable.id, existing.id));
  res.json(UpdateResourceResponse.parse(row));
});

router.delete("/resources/:id", async (req, res): Promise<void> => {
  const params = DeleteResourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await resourceSelect().where(eq(resourcesTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Resource not found" });
    return;
  }
  await db.delete(resourcesTable).where(eq(resourcesTable.id, params.data.id));
  await logAudit(
    "delete",
    "Resource",
    `Removed resource ${row.name} from ${row.appName} (grants revoked)`,
    req.session.user?.name,
  );
  res.sendStatus(204);
});

export default router;
