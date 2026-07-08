import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const appUsersTable = pgTable("app_user", {
  id: serial("id").primaryKey(),
  entraObjectId: text("entra_object_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  lastLoginAt: timestamp("last_login_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
