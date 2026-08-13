import { boolean, integer, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { appsTable } from "./apps";

export const rolesTable = pgTable(
  "roles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    description: text("description").notNull().default(""),
    appId: integer("app_id").references(() => appsTable.id, { onDelete: "cascade" }),
    isEntitlement: boolean("is_entitlement").notNull().default(false),
  },
  (t) => [
    uniqueIndex("roles_app_name_lower_unique")
      .on(t.appId, sql`lower(${t.name})`)
      .where(sql`${t.appId} is not null`),
  ],
);

export const insertRoleSchema = createInsertSchema(rolesTable).omit({ id: true });
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof rolesTable.$inferSelect;
