import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailLogsTable = pgTable("email_logs", {
  id: serial("id").primaryKey(),
  recipientEmail: text("recipient_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body"),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmailLogSchema = createInsertSchema(emailLogsTable).omit({ id: true, createdAt: true });
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLog = typeof emailLogsTable.$inferSelect;

export const smsLogsTable = pgTable("sms_logs", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("pending"),
  provider: text("provider"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSmsLogSchema = createInsertSchema(smsLogsTable).omit({ id: true, createdAt: true });
export type InsertSmsLog = z.infer<typeof insertSmsLogSchema>;
export type SmsLog = typeof smsLogsTable.$inferSelect;
