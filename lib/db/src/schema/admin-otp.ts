import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// One-time codes issued during Master Admin 2-step login verification.
// A fresh row is created per attempt; codes are single-use and expire based
// on the admin-configured expiry window (app_settings.admin2faOtpExpiryMinutes).
export const adminOtpCodesTable = pgTable("admin_otp_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  code: text("code").notNull(),
  method: text("method").notNull().default("email"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAdminOtpCodeSchema = createInsertSchema(adminOtpCodesTable).omit({ id: true, createdAt: true });
export type InsertAdminOtpCode = z.infer<typeof insertAdminOtpCodeSchema>;
export type AdminOtpCode = typeof adminOtpCodesTable.$inferSelect;
