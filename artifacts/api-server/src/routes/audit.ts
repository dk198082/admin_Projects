import { Router, type IRouter } from "express";
import { desc, eq, count, inArray, notInArray, and, gte, sql, SQL } from "drizzle-orm";
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
  GetDeniedAccessSummaryQueryParams,
  GetDeniedAccessSummaryResponse,
} from "@workspace/api-zod";

const ACCESS_ACTIONS = ["ACCESS_ALLOWED", "ACCESS_DENIED"] as const;

const router: IRouter = Router();

router.get("/denied-access-summary", async (req, res): Promise<void> => {
  const query = GetDeniedAccessSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const threshold = query.data.threshold ?? 5;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [totalRow] = await db
    .select({ n: count() })
    .from(auditLogTable)
    .where(and(eq(auditLogTable.action, "ACCESS_DENIED"), gte(auditLogTable.createdAt, since)));

  const hotKeyRows = await db
    .select({ actor: auditLogTable.actor, n: count() })
    .from(auditLogTable)
    .where(and(eq(auditLogTable.action, "ACCESS_DENIED"), gte(auditLogTable.createdAt, since)))
    .groupBy(auditLogTable.actor)
    .having(sql`count(*) >= ${threshold}`)
    .orderBy(desc(sql`count(*)`));

  const topEntityRows = await db
    .select({ entity: auditLogTable.entity, n: count() })
    .from(auditLogTable)
    .where(and(eq(auditLogTable.action, "ACCESS_DENIED"), gte(auditLogTable.createdAt, since)))
    .groupBy(auditLogTable.entity)
    .having(sql`count(*) >= ${threshold}`)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  // Collect unique entity values and resolve any that match a known user's entraObjectId
  const entityValues = topEntityRows.map((r) => r.entity).filter(Boolean);
  const userDisplayNames = new Map<string, string>();
  if (entityValues.length > 0) {
    const matchedUsers = await db
      .select({ entraObjectId: usersTable.entraObjectId, name: usersTable.name })
      .from(usersTable)
      .where(inArray(usersTable.entraObjectId, entityValues));
    for (const u of matchedUsers) {
      if (u.entraObjectId) {
        userDisplayNames.set(u.entraObjectId, u.name);
      }
    }
  }

  res.json(
    GetDeniedAccessSummaryResponse.parse({
      total24h: totalRow.n,
      threshold,
      hotKeys: hotKeyRows.map((r) => ({ actor: r.actor, count: r.n })),
      topEntities: topEntityRows.map((r) => ({
        entity: r.entity,
        count: r.n,
        displayName: userDisplayNames.get(r.entity) ?? null,
      })),
    }),
  );
});

router.get("/audit-log", async (req, res): Promise<void> => {
  const query = ListAuditLogQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { limit, category, outcome } = query.data;

  // Build WHERE conditions based on filters
  const conditions: SQL[] = [];

  if (category === "access") {
    conditions.push(inArray(auditLogTable.action, [...ACCESS_ACTIONS]));
  } else if (category === "admin") {
    conditions.push(notInArray(auditLogTable.action, [...ACCESS_ACTIONS]));
  }

  if (outcome === "allowed") {
    conditions.push(eq(auditLogTable.action, "ACCESS_ALLOWED"));
  } else if (outcome === "denied") {
    conditions.push(eq(auditLogTable.action, "ACCESS_DENIED"));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(auditLogTable)
    .where(whereClause)
    .orderBy(desc(auditLogTable.createdAt), desc(auditLogTable.id))
    .limit(limit ?? 50);

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
