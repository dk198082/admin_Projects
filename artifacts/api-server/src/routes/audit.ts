import { Router, type IRouter } from "express";
import { desc, eq, count, inArray, notInArray, and, gte, lt, sql, SQL } from "drizzle-orm";
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
  GetActivityReportQueryParams,
  GetActivityReportResponse,
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

router.get("/activity-report", async (req, res): Promise<void> => {
  const query = GetActivityReportQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = query.data.from ?? defaultFrom;
  const to = query.data.to ?? today;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(from) || !datePattern.test(to)) {
    res.status(400).json({ error: "from and to must use YYYY-MM-DD format" });
    return;
  }

  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || from > to) {
    res.status(400).json({ error: "The activity report date range is invalid" });
    return;
  }
  toDate.setUTCDate(toDate.getUTCDate() + 1);

  const [rows, users, apps] = await Promise.all([
    db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.action, "ACCESS_ALLOWED"),
          gte(auditLogTable.createdAt, fromDate),
          lt(auditLogTable.createdAt, toDate),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt)),
    db.select({ entraObjectId: usersTable.entraObjectId, name: usersTable.name }).from(usersTable),
    db.select({ name: appsTable.name }).from(appsTable),
  ]);

  const userNames = new Map(users.map((user) => [user.entraObjectId, user.name]));
  const appNames = apps.map((app) => app.name).sort((a, b) => b.length - a.length);
  type AllowedAccess = { person: string; app: string };
  const allowedAccesses: AllowedAccess[] = [];
  for (const row of rows) {
    if (row.action !== "ACCESS_ALLOWED") continue;
    const marker = " app=";
    const markerIndex = row.detail.indexOf(marker);
    const app = appNames.find(
      (candidate) =>
        markerIndex >= 0 &&
        row.detail.slice(markerIndex + marker.length).startsWith(candidate) &&
        (
          row.detail.length === markerIndex + marker.length + candidate.length ||
          row.detail[markerIndex + marker.length + candidate.length] === " "
        ),
    ) ?? "Unknown app";
    allowedAccesses.push({ person: userNames.get(row.entity) ?? row.entity, app });
  }

  const personFilters = query.data.person
    ?.map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const appFilter = query.data.app?.trim().toLowerCase();
  const filteredAccesses = allowedAccesses.filter((event) => {
    if (personFilters?.length && !personFilters.includes(event.person.toLowerCase())) return false;
    if (appFilter && event.app.toLowerCase() !== appFilter) return false;
    return true;
  });

  const byPersonApp = new Map<string, { person: string; app: string; allowedAccess: number }>();
  const activePeople = new Set<string>();
  const activeApps = new Set<string>();
  const summary = {
    allowedAccess: filteredAccesses.length,
    activePeople: 0,
    activeApps: 0,
  };

  for (const event of filteredAccesses) {
    activePeople.add(event.person);
    activeApps.add(event.app);
    const key = `${event.person}\u0000${event.app}`;
    const row = byPersonApp.get(key) ?? { person: event.person, app: event.app, allowedAccess: 0 };
    row.allowedAccess += 1;
    byPersonApp.set(key, row);
  }

  summary.activePeople = activePeople.size;
  summary.activeApps = activeApps.size;
  res.json(
    GetActivityReportResponse.parse({
      from,
      to,
      summary,
      byPersonApp: [...byPersonApp.values()].sort(
        (a, b) => b.allowedAccess - a.allowedAccess || a.person.localeCompare(b.person) || a.app.localeCompare(b.app),
      ),
    }),
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
