import { Router, type IRouter } from "express";
import { eq, asc, inArray } from "drizzle-orm";
import {
  db,
  rolesTable,
  usersTable,
  roleAssignmentsTable,
  accessGrantsTable,
} from "@workspace/db";
import {
  ListRolesResponse,
  CreateRoleBody,
  CreateRoleResponse,
  ListRoleAssignmentsResponse,
  CreateRoleAssignmentBody,
  CreateRoleAssignmentResponse,
  BulkCreateRoleAssignmentsBody,
  BulkCreateRoleAssignmentsResponse,
  DeleteRoleAssignmentParams,
} from "@workspace/api-zod";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/roles", async (_req, res): Promise<void> => {
  const roles = await db.select().from(rolesTable).orderBy(asc(rolesTable.id));
  const assignments = await db.select().from(roleAssignmentsTable);
  const grants = await db.select().from(accessGrantsTable);
  const result = roles.map((r) => ({
    ...r,
    userCount: assignments.filter((a) => a.roleId === r.id).length,
    grantCount: grants.filter((g) => g.roleId === r.id).length,
  }));
  res.json(ListRolesResponse.parse(result));
});

router.post("/roles", async (req, res): Promise<void> => {
  const parsed = CreateRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Role name is required" });
    return;
  }
  const [inserted] = await db
    .insert(rolesTable)
    .values({ name, description: parsed.data.description?.trim() ?? "" })
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    res.status(400).json({ error: "A role with that name already exists" });
    return;
  }
  await logAudit("create", "Role", `Created role ${inserted.name}`);
  res
    .status(201)
    .json(CreateRoleResponse.parse({ ...inserted, userCount: 0, grantCount: 0 }));
});

router.post("/role-assignments/bulk", async (req, res): Promise<void> => {
  const parsed = BulkCreateRoleAssignmentsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userIds = [...new Set(parsed.data.userIds)];
  const roleIds = [...new Set(parsed.data.roleIds)];
  const users = await db.select().from(usersTable).where(inArray(usersTable.id, userIds));
  const roles = await db.select().from(rolesTable).where(inArray(rolesTable.id, roleIds));
  if (users.length !== userIds.length || roles.length !== roleIds.length) {
    res.status(400).json({ error: "One or more users or roles do not exist" });
    return;
  }
  const pairs = userIds.flatMap((userId) => roleIds.map((roleId) => ({ userId, roleId })));
  const inserted = await db
    .insert(roleAssignmentsTable)
    .values(pairs)
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) {
    const roleNames = roles.map((r) => r.name).join(", ");
    const userNames = users.map((u) => u.name).join(", ");
    await logAudit(
      "assign",
      "Role",
      `Bulk assigned role(s) ${roleNames} to user(s) ${userNames} (${inserted.length} new assignment(s))`,
    );
  }
  res.json(
    BulkCreateRoleAssignmentsResponse.parse({
      created: inserted.length,
      skipped: pairs.length - inserted.length,
    }),
  );
});

router.get("/role-assignments", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: roleAssignmentsTable.id,
      userId: usersTable.id,
      userName: usersTable.name,
      roleId: rolesTable.id,
      roleName: rolesTable.name,
      createdAt: roleAssignmentsTable.createdAt,
    })
    .from(roleAssignmentsTable)
    .innerJoin(usersTable, eq(roleAssignmentsTable.userId, usersTable.id))
    .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
    .orderBy(asc(usersTable.name));
  res.json(
    ListRoleAssignmentsResponse.parse(
      rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    ),
  );
});

router.post("/role-assignments", async (req, res): Promise<void> => {
  const parsed = CreateRoleAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [inserted] = await db
    .insert(roleAssignmentsTable)
    .values(parsed.data)
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    res.status(400).json({ error: "This user already has that role" });
    return;
  }
  const [row] = await db
    .select({
      id: roleAssignmentsTable.id,
      userId: usersTable.id,
      userName: usersTable.name,
      roleId: rolesTable.id,
      roleName: rolesTable.name,
      createdAt: roleAssignmentsTable.createdAt,
    })
    .from(roleAssignmentsTable)
    .innerJoin(usersTable, eq(roleAssignmentsTable.userId, usersTable.id))
    .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
    .where(eq(roleAssignmentsTable.id, inserted.id));
  await logAudit("assign", "Role", `Assigned role ${row.roleName} to ${row.userName}`);
  res
    .status(201)
    .json(
      CreateRoleAssignmentResponse.parse({ ...row, createdAt: row.createdAt.toISOString() }),
    );
});

router.delete("/role-assignments/:id", async (req, res): Promise<void> => {
  const params = DeleteRoleAssignmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select({
      userName: usersTable.name,
      roleName: rolesTable.name,
    })
    .from(roleAssignmentsTable)
    .innerJoin(usersTable, eq(roleAssignmentsTable.userId, usersTable.id))
    .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
    .where(eq(roleAssignmentsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  await db.delete(roleAssignmentsTable).where(eq(roleAssignmentsTable.id, params.data.id));
  await logAudit("revoke", "Role", `Removed role ${row.roleName} from ${row.userName}`);
  res.sendStatus(204);
});

export default router;
