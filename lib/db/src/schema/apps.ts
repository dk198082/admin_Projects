import { pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const appsTable = pgTable(
  "apps",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull().unique(),
    // --- Workspace Shell fields (all nullable — existing apps keep working
    // via the Admin Console's own CRUD flows without setting these; an app
    // simply doesn't appear as a tile in the shell until launchUrl is set).
    // See artifacts/workspace-shell and docs/workspace/TECHNICAL_DESIGN.md.
    launchUrl: text("launch_url"),
    description: text("description"),
    // Name of a lucide-react icon (e.g. "Wrench", "ShoppingCart") — validated
    // against a known allow-list client-side; an unrecognized value falls
    // back to a generic app icon rather than failing to render.
    icon: text("icon"),
    // Free-text grouping label for the shell's tile layout (e.g. "Field
    // Operations", "Administration"). Apps with no category are grouped
    // under "Other".
    category: text("category"),
  },
  (t) => [uniqueIndex("apps_name_lower_unique").on(sql`lower(${t.name})`)],
);

export const insertAppSchema = createInsertSchema(appsTable).omit({ id: true });
export type InsertApp = z.infer<typeof insertAppSchema>;
export type App = typeof appsTable.$inferSelect;

export const updateAppLaunchSchema = z.object({
  launchUrl: z.string().url().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(100).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
});
export type UpdateAppLaunch = z.infer<typeof updateAppLaunchSchema>;
