import { Router, type IRouter } from "express";
import { eq, inArray, asc } from "drizzle-orm";
import {
  db,
  usersTable,
  rolesTable,
  roleAssignmentsTable,
} from "@workspace/db";
import {
  BulkImportUsersBody,
  BulkImportUsersResponse,
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
  const { name, email, status, entraObjectId, roleIds } = parsed.data;
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing.length > 0) {
    res.status(400).json({ error: "A user with this email already exists" });
    return;
  }
  if (entraObjectId) {
    const dup = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.entraObjectId, entraObjectId));
    if (dup.length > 0) {
      res.status(400).json({ error: "This Azure Entra user is already added" });
      return;
    }
  }
  const [user] = await db
    .insert(usersTable)
    .values({ name, email, status: status ?? "active", entraObjectId: entraObjectId ?? null })
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
      await logAudit("assign", "Role", `Assigned role ${role.name} to ${name}`, req.session.user?.name);
    }
  }
  await logAudit("create", "User", `Created user ${name} (${email})`, req.session.user?.name);
  const full = await userWithRoles(user.id);
  res.status(201).json(CreateUserResponse.parse(full));
});

router.post("/users/bulk-import", async (req, res): Promise<void> => {
  const parsed = BulkImportUsersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { users, roleIds } = parsed.data;

  if (roleIds && roleIds.length > 0) {
    const validRoles = await db.select().from(rolesTable).where(inArray(rolesTable.id, roleIds));
    if (validRoles.length !== roleIds.length) {
      res.status(400).json({ error: "One or more roles do not exist" });
      return;
    }
  }

  const existing = await db
    .select({ email: usersTable.email, entraObjectId: usersTable.entraObjectId })
    .from(usersTable);
  const existingEmails = new Set(existing.map((u) => u.email.toLowerCase()));
  const existingEntraIds = new Set(
    existing.map((u) => u.entraObjectId).filter((v): v is string => !!v),
  );

  let created = 0;
  let skipped = 0;
  let assignedRoles = 0;
  const createdNames: string[] = [];

  await db.transaction(async (tx) => {
    for (const u of users) {
      const emailLower = u.email.toLowerCase();
      if (existingEmails.has(emailLower) || (u.entraObjectId && existingEntraIds.has(u.entraObjectId))) {
        skipped++;
        continue;
      }
      const [inserted] = await tx
        .insert(usersTable)
        .values({
          name: u.name,
          email: u.email,
          status: u.status ?? "active",
          entraObjectId: u.entraObjectId ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted) {
        skipped++;
        continue;
      }
      existingEmails.add(emailLower);
      if (u.entraObjectId) existingEntraIds.add(u.entraObjectId);
      created++;
      createdNames.push(inserted.name);
      if (roleIds && roleIds.length > 0) {
        const result = await tx
          .insert(roleAssignmentsTable)
          .values(roleIds.map((roleId) => ({ userId: inserted.id, roleId })))
          .onConflictDoNothing()
          .returning();
        assignedRoles += result.length;
      }
    }
  });

  if (created > 0) {
    await logAudit(
      "create",
      "User",
      `Bulk imported ${created} user(s)${skipped ? ` (${skipped} skipped as existing)` : ""}${assignedRoles ? `, ${assignedRoles} role assignment(s)` : ""}: ${createdNames.slice(0, 10).join(", ")}${createdNames.length > 10 ? "..." : ""}`,
      req.session.user?.name,
    );
  }

  res.json(BulkImportUsersResponse.parse({ created, skipped, assignedRoles }));
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
  const updateData = { ...parsed.data };
  if (updateData.entraObjectId !== undefined && updateData.entraObjectId.trim() === "") {
    delete updateData.entraObjectId;
  }
  const [user] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.id, params.data.id))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await logAudit("update", "User", `Updated user ${user.name}`, req.session.user?.name);
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
  await logAudit("delete", "User", `Deleted user ${user.name} (${user.email})`, req.session.user?.name);
  res.sendStatus(204);
});

export default router;
