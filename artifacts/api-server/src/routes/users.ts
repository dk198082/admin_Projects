import { Router, type IRouter } from "express";
import { eq, inArray, asc } from "drizzle-orm";
import {
  db,
  usersTable,
  rolesTable,
  roleAssignmentsTable,
} from "@workspace/db";
import {
  CreateUserBody,
  CreateUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
  DeleteUserParams,
  ListUsersResponse,
} from "@workspace/api-zod";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

async function userWithRoles(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return null;
  const roles = await db
    .select({
      assignmentId: roleAssignmentsTable.id,
      roleId: rolesTable.id,
      roleName: rolesTable.name,
    })
    .from(roleAssignmentsTable)
    .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
    .where(eq(roleAssignmentsTable.userId, userId));
  return { ...user, createdAt: user.createdAt.toISOString(), roles };
}

router.get("/users", async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(asc(usersTable.name));
  const ids = users.map((u) => u.id);
  const assignments = ids.length
    ? await db
        .select({
          assignmentId: roleAssignmentsTable.id,
          userId: roleAssignmentsTable.userId,
          roleId: rolesTable.id,
          roleName: rolesTable.name,
        })
        .from(roleAssignmentsTable)
        .innerJoin(rolesTable, eq(roleAssignmentsTable.roleId, rolesTable.id))
        .where(inArray(roleAssignmentsTable.userId, ids))
    : [];
  const result = users.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
    roles: assignments
      .filter((a) => a.userId === u.id)
      .map(({ assignmentId, roleId, roleName }) => ({ assignmentId, roleId, roleName })),
  }));
  res.json(ListUsersResponse.parse(result));
});

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { name, email, status, roleIds } = parsed.data;
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing.length > 0) {
    res.status(400).json({ error: "A user with this email already exists" });
    return;
  }
  const [user] = await db
    .insert(usersTable)
    .values({ name, email, status: status ?? "active" })
    .returning();
  if (roleIds && roleIds.length > 0) {
    const validRoles = await db
      .select()
      .from(rolesTable)
      .where(inArray(rolesTable.id, roleIds));
    if (validRoles.length !== roleIds.length) {
      await db.delete(usersTable).where(eq(usersTable.id, user.id));
      res.status(400).json({ error: "One or more roles do not exist" });
      return;
    }
    await db
      .insert(roleAssignmentsTable)
      .values(roleIds.map((roleId) => ({ userId: user.id, roleId })))
      .onConflictDoNothing();
    for (const role of validRoles) {
      await logAudit("assign", "Role", `Assigned role ${role.name} to ${name}`);
    }
  }
  await logAudit("create", "User", `Created user ${name} (${email})`);
  const full = await userWithRoles(user.id);
  res.status(201).json(CreateUserResponse.parse(full));
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [user] = await db
    .update(usersTable)
    .set(parsed.data)
    .where(eq(usersTable.id, params.data.id))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await logAudit("update", "User", `Updated user ${user.name}`);
  const full = await userWithRoles(user.id);
  res.json(UpdateUserResponse.parse(full));
});

router.delete("/users/:id", async (req, res): Promise<void> => {
  const params = DeleteUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [user] = await db
    .delete(usersTable)
    .where(eq(usersTable.id, params.data.id))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await logAudit("delete", "User", `Deleted user ${user.name} (${user.email})`);
  res.sendStatus(204);
});

export default router;
