import { integer, pgTable, serial, text, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { resourcesTable } from "./resources";
import { rolesTable } from "./roles";

export const accessGrantsTable = pgTable(
  "access_grants",
  {
    id: serial("id").primaryKey(),
    roleId: integer("role_id")
      .notNull()
      .references(() => rolesTable.id, { onDelete: "cascade" }),
    resourceId: integer("resource_id")
      .notNull()
      .references(() => resourcesTable.id, { onDelete: "cascade" }),
    level: text("level").notNull(),
  },
  (t) => [unique("access_grants_role_resource_unique").on(t.roleId, t.resourceId)],
);

export const insertAccessGrantSchema = createInsertSchema(accessGrantsTable).omit({ id: true });
export type InsertAccessGrant = z.infer<typeof insertAccessGrantSchema>;
export type AccessGrant = typeof accessGrantsTable.$inferSelect;
