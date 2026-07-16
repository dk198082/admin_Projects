import { pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const appsTable = pgTable(
  "apps",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
  },
  (t) => [uniqueIndex("apps_name_lower_unique").on(sql`lower(${t.name})`)],
);

export const insertAppSchema = createInsertSchema(appsTable).omit({ id: true });
export type InsertApp = z.infer<typeof insertAppSchema>;
export type App = typeof appsTable.$inferSelect;
