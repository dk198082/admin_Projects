import { boolean, integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { appsTable } from "./apps";

export const securityPoliciesTable = pgTable("security_policies", {
  id: serial("id").primaryKey(),
  appId: integer("app_id")
    .notNull()
    .unique()
    .references(() => appsTable.id, { onDelete: "cascade" }),
  authMethod: text("auth_method").notNull().default("SSO (Entra ID)"),
  mfaRequired: text("mfa_required").notNull().default("All users"),
  sessionTimeoutMinutes: integer("session_timeout_minutes").notNull().default(30),
  recordLevelScope: text("record_level_scope").notNull().default(""),
  fieldLevelRules: text("field_level_rules").notNull().default(""),
  auditLogging: boolean("audit_logging").notNull().default(true),
  dataExportPolicy: text("data_export_policy").notNull().default(""),
});

export const insertSecurityPolicySchema = createInsertSchema(securityPoliciesTable).omit({
  id: true,
});
export type InsertSecurityPolicy = z.infer<typeof insertSecurityPolicySchema>;
export type SecurityPolicy = typeof securityPoliciesTable.$inferSelect;
