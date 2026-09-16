import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const doctorNoticesTable = pgTable("doctor_notices", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("general"),
  fromDate: text("from_date"),
  toDate: text("to_date"),
  fromTime: text("from_time"),
  toTime: text("to_time"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDoctorNoticeSchema = createInsertSchema(doctorNoticesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDoctorNotice = z.infer<typeof insertDoctorNoticeSchema>;
export type DoctorNotice = typeof doctorNoticesTable.$inferSelect;
