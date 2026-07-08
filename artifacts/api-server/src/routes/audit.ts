import { Router, type IRouter } from "express";
import { desc, eq, count } from "drizzle-orm";
import {
  db,
  auditLogTable,
  usersTable,
  rolesTable,
  appsTable,
  resourcesTable,
  accessGrantsTable,
  roleAssignmentsTable,
} from "@workspace/db";
import {
  ListAuditLogQueryParams,
  ListAuditLogResponse,
  GetSummaryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/audit-log", async (req, res): Promise<void> => {
  const query = ListAuditLogQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
    .limit(query.data.limit ?? 50);
  res.json(
    ListAuditLogResponse.parse(
      rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    ),
  );
});

router.get("/summary", async (_req, res): Promise<void> => {
  const [
    [usersCount],
    [activeCount],
    [rolesCount],
    [appsCount],
    [resourcesCount],
    [grantsCount],
    [assignmentsCount],
    [auditCount],
  ] = await Promise.all([
    db.select({ n: count() }).from(usersTable),
    db.select({ n: count() }).from(usersTable).where(eq(usersTable.status, "active")),
    db.select({ n: count() }).from(rolesTable),
    db.select({ n: count() }).from(appsTable),
    db.select({ n: count() }).from(resourcesTable),
    db.select({ n: count() }).from(accessGrantsTable),
    db.select({ n: count() }).from(roleAssignmentsTable),
    db.select({ n: count() }).from(auditLogTable),
  ]);
  res.json(
    GetSummaryResponse.parse({
      users: usersCount.n,
      activeUsers: activeCount.n,
      roles: rolesCount.n,
      apps: appsCount.n,
      resources: resourcesCount.n,
      grants: grantsCount.n,
      assignments: assignmentsCount.n,
      auditEntries: auditCount.n,
    }),
  );
});

export default router;
