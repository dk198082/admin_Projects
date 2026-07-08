import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, appsTable, resourcesTable } from "@workspace/db";
import {
  ListAppsResponse,
  ListResourcesQueryParams,
  ListResourcesResponse,
} from "@workspace/api-zod";

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

router.get("/resources", async (req, res): Promise<void> => {
  const query = ListResourcesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const base = db
    .select({
      id: resourcesTable.id,
      appId: resourcesTable.appId,
      appName: appsTable.name,
      name: resourcesTable.name,
      type: resourcesTable.type,
      description: resourcesTable.description,
    })
    .from(resourcesTable)
    .innerJoin(appsTable, eq(resourcesTable.appId, appsTable.id))
    .orderBy(asc(resourcesTable.appId), asc(resourcesTable.type), asc(resourcesTable.name));
  const rows =
    query.data.appId !== undefined
      ? await base.where(eq(resourcesTable.appId, query.data.appId))
      : await base;
  res.json(ListResourcesResponse.parse(rows));
});

export default router;
