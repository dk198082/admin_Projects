import { Router, type IRouter } from "express";
import { and, eq, asc, type SQL } from "drizzle-orm";
import {
  db,
  accessGrantsTable,
  resourcesTable,
  rolesTable,
  appsTable,
} from "@workspace/db";
import {
  ListAccessGrantsQueryParams,
  ListAccessGrantsResponse,
  CreateAccessGrantBody,
  CreateAccessGrantResponse,
  UpdateAccessGrantParams,
  UpdateAccessGrantBody,
  UpdateAccessGrantResponse,
  DeleteAccessGrantParams,
} from "@workspace/api-zod";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

function enrichedSelect() {
  return db
    .select({
      id: accessGrantsTable.id,
      roleId: rolesTable.id,
      roleName: rolesTable.name,
      resourceId: resourcesTable.id,
      resourceName: resourcesTable.name,
      resourceType: resourcesTable.type,
      appId: appsTable.id,
      appName: appsTable.name,
      level: accessGrantsTable.level,
    })
    .from(accessGrantsTable)
    .innerJoin(rolesTable, eq(accessGrantsTable.roleId, rolesTable.id))
    .innerJoin(resourcesTable, eq(accessGrantsTable.resourceId, resourcesTable.id))
    .innerJoin(appsTable, eq(resourcesTable.appId, appsTable.id));
}

router.get("/access-grants", async (req, res): Promise<void> => {
  const query = ListAccessGrantsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const conditions: SQL[] = [];
  if (query.data.appId !== undefined) conditions.push(eq(resourcesTable.appId, query.data.appId));
  if (query.data.roleId !== undefined)
    conditions.push(eq(accessGrantsTable.roleId, query.data.roleId));
  const base = enrichedSelect().orderBy(
    asc(appsTable.id),
    asc(rolesTable.id),
    asc(resourcesTable.name),
  );
  const rows = conditions.length ? await base.where(and(...conditions)) : await base;
  res.json(ListAccessGrantsResponse.parse(rows));
});

router.post("/access-grants", async (req, res): Promise<void> => {
  const parsed = CreateAccessGrantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [inserted] = await db
    .insert(accessGrantsTable)
    .values(parsed.data)
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    res.status(400).json({ error: "This role already has a grant on that resource" });
    return;
  }
  const [row] = await enrichedSelect().where(eq(accessGrantsTable.id, inserted.id));
  await logAudit(
    "grant",
    "Permission",
    `Granted ${row.level} on ${row.appName} / ${row.resourceName} to ${row.roleName}`,
  );
  res.status(201).json(CreateAccessGrantResponse.parse(row));
});

router.patch("/access-grants/:id", async (req, res): Promise<void> => {
  const params = UpdateAccessGrantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAccessGrantBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(accessGrantsTable)
    .set({ level: parsed.data.level })
    .where(eq(accessGrantsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Grant not found" });
    return;
  }
  const [row] = await enrichedSelect().where(eq(accessGrantsTable.id, updated.id));
  await logAudit(
    "update",
    "Permission",
    `Changed ${row.roleName} access on ${row.appName} / ${row.resourceName} to ${row.level}`,
  );
  res.json(UpdateAccessGrantResponse.parse(row));
});

router.delete("/access-grants/:id", async (req, res): Promise<void> => {
  const params = DeleteAccessGrantParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await enrichedSelect().where(eq(accessGrantsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Grant not found" });
    return;
  }
  await db.delete(accessGrantsTable).where(eq(accessGrantsTable.id, params.data.id));
  await logAudit(
    "revoke",
    "Permission",
    `Revoked ${row.roleName} access (${row.level}) on ${row.appName} / ${row.resourceName}`,
  );
  res.sendStatus(204);
});

export default router;
