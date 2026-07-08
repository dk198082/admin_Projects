import { integer, pgTable, serial, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { rolesTable } from "./roles";
import { usersTable } from "./users";

export const roleAssignmentsTable = pgTable(
  "role_assignments",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("role_assignments_user_role_unique").on(t.userId, t.roleId)],
);

export const insertRoleAssignmentSchema = createInsertSchema(roleAssignmentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertRoleAssignment = z.infer<typeof insertRoleAssignmentSchema>;
export type RoleAssignment = typeof roleAssignmentsTable.$inferSelect;
