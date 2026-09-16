import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const queueDisplayDevicesTable = pgTable("queue_display_devices", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull(),
  name: text("name").notNull(),
  displayType: text("display_type").notNull().default("tv"),
  width: integer("width"),
  height: integer("height"),
  fontSize: integer("font_size").notNull().default(100),
  layoutSize: integer("layout_size").notNull().default(100),
  fullscreen: boolean("fullscreen").notNull().default(true),
  orientation: text("orientation").notNull().default("landscape"),
  isActive: boolean("is_active").notNull().default(true),
  // Display content settings
  showPatientName: boolean("show_patient_name").notNull().default(true),
  showDoctorName: boolean("show_doctor_name").notNull().default(true),
  voiceEnabled: boolean("voice_enabled").notNull().default(false),
  voiceLanguage: text("voice_language").notNull().default("en"),
  theme: text("theme").notNull().default("dark"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertQueueDisplayDeviceSchema = createInsertSchema(queueDisplayDevicesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQueueDisplayDevice = z.infer<typeof insertQueueDisplayDeviceSchema>;
export type QueueDisplayDevice = typeof queueDisplayDevicesTable.$inferSelect;
