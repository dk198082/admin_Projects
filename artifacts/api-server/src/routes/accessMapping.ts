import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  appsTable,
  rolesTable,
  usersTable,
  roleAssignmentsTable,
} from "@workspace/db";
import {
  ListAccessMappingResponse,
  AssignAccessMappingBody,
  AssignAccessMappingResponse,
  RemoveAccessMappingBody,
  RemoveAccessMappingResponse,
} from "@workspace/api-zod";
import { logAudit } from "../lib/audit";
import {
  ensureEntitlementsForApp,
  entitlementLevelFromRoleName,
  entitlementRoleName,
  type EntitlementLevel,
} from "../lib/entitlements";

const router: IRouter = Router();

router.get("/access-mapping", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      assignmentId: roleAssignmentsTable.id,
      userId: usersTable.id,
      userName: usersTable.name,
      userEmail: usersTable.email,
      appId: appsTable.id,
      appName: appsTable.name,
      roleId: rolesTable.id,
      roleName: rolesTable.name,
      createdAt: roleAssignmentsTable.createdAt,
    })
    .from(roleAssignmentsTable)
    .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
    .innerJoin(usersTable, eq(roleAssignmentsTable.userId, usersTable.id))
    .innerJoin(appsTable, eq(rolesTable.appId, appsTable.id))
    .where(eq(rolesTable.isEntitlement, true))
    .orderBy(asc(usersTable.name), asc(appsTable.name));
  const result = rows
    .map((r) => ({
      ...r,
      level: entitlementLevelFromRoleName(r.roleName, r.appName),
      createdAt: r.createdAt.toISOString(),
    }))
    .filter((r) => r.level !== null);
  res.json(ListAccessMappingResponse.parse(result));
});

router.post("/access-mapping/assign", async (req, res): Promise<void> => {
  const parsed = AssignAccessMappingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userIds = [...new Set(parsed.data.userIds)];
  const appIds = [...new Set(parsed.data.appIds)];
  const level = parsed.data.level as EntitlementLevel;

  const users = await db.select().from(usersTable).where(inArray(usersTable.id, userIds));
  const apps = await db.select().from(appsTable).where(inArray(appsTable.id, appIds));
  if (users.length !== userIds.length) {
    res.status(400).json({ error: "One or more users not found" });
    return;
  }
  if (apps.length !== appIds.length) {
    res.status(400).json({ error: "One or more apps not found" });
    return;
  }

  const { assigned, updated, skipped } = await db.transaction(async (tx) => {
    let assigned = 0;
    let updated = 0;
    let skipped = 0;

    for (const app of apps) {
      await ensureEntitlementsForApp(app.id, app.name, tx);
      const entitlementRoles = await tx
        .select()
        .from(rolesTable)
        .where(and(eq(rolesTable.appId, app.id), eq(rolesTable.isEntitlement, true)));
      const target = entitlementRoles.find(
        (r) => r.name === entitlementRoleName(app.name, level),
      );
      if (!target) continue;
      const otherIds = entitlementRoles.filter((r) => r.id !== target.id).map((r) => r.id);

      for (const user of users) {
        const [existing] = await tx
          .select()
          .from(roleAssignmentsTable)
          .where(
            and(
              eq(roleAssignmentsTable.userId, user.id),
              eq(roleAssignmentsTable.roleId, target.id),
            ),
          );
        let removedOther = 0;
        if (otherIds.length > 0) {
          const removed = await tx
            .delete(roleAssignmentsTable)
            .where(
              and(
                eq(roleAssignmentsTable.userId, user.id),
                inArray(roleAssignmentsTable.roleId, otherIds),
              ),
            )
            .returning({ id: roleAssignmentsTable.id });
          removedOther = removed.length;
        }
        if (existing) {
          skipped += 1;
          continue;
        }
        await tx
          .insert(roleAssignmentsTable)
          .values({ userId: user.id, roleId: target.id })
          .onConflictDoNothing();
        if (removedOther > 0) updated += 1;
        else assigned += 1;
      }
    }
    return { assigned, updated, skipped };
  });

  await logAudit(
    "update",
    "Access Mapping",
    `Set ${level} access on ${apps.map((a) => a.name).join(", ")} for ${users
      .slice(0, 10)
      .map((u) => u.name)
      .join(", ")}${users.length > 10 ? ` and ${users.length - 10} more` : ""}`,
    req.session.user?.name,
  );
  res.json(AssignAccessMappingResponse.parse({ assigned, updated, skipped }));
});

router.post("/access-mapping/remove", async (req, res): Promise<void> => {
  const parsed = RemoveAccessMappingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userIds = [...new Set(parsed.data.userIds)];
  const appIds = [...new Set(parsed.data.appIds)];
  const apps = await db.select().from(appsTable).where(inArray(appsTable.id, appIds));
  const users = await db.select().from(usersTable).where(inArray(usersTable.id, userIds));
  const entitlementRoles = await db
    .select({ id: rolesTable.id })
    .from(rolesTable)
    .where(and(inArray(rolesTable.appId, appIds), eq(rolesTable.isEntitlement, true)));
  let removed = 0;
  if (entitlementRoles.length > 0) {
    const rows = await db
      .delete(roleAssignmentsTable)
      .where(
        and(
          inArray(roleAssignmentsTable.userId, userIds),
          inArray(
            roleAssignmentsTable.roleId,
            entitlementRoles.map((r) => r.id),
          ),
        ),
      )
      .returning({ id: roleAssignmentsTable.id });
    removed = rows.length;
  }
  await logAudit(
    "delete",
    "Access Mapping",
    `Removed app access to ${apps.map((a) => a.name).join(", ")} for ${users
      .slice(0, 10)
      .map((u) => u.name)
      .join(", ")}${users.length > 10 ? ` and ${users.length - 10} more` : ""}`,
    req.session.user?.name,
  );
  res.json(RemoveAccessMappingResponse.parse({ removed }));
});

export default router;
