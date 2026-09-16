import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Emergency Contact Directory — admin-managed, publicly searchable.
 * `category` is free-form text (not an enum) so new categories can be added
 * without a schema change: ambulance | oxygen | blood_donor | emergency_doctor
 * | diagnostic_support | hospital_contact | any future category.
 */
export const emergencyContactsTable = pgTable("emergency_contacts", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  name: text("name").notNull(),
  mobileNumber: text("mobile_number").notNull(),
  /** Ambulance-only fields; null for other categories */
  driverName: text("driver_name"),
  vehicleNumber: text("vehicle_number"),
  country: text("country").notNull().default("Bangladesh"),
  division: text("division"),
  district: text("district"),
  upazila: text("upazila"),
  area: text("area"),
  notes: text("notes"),
  /** "available" | "busy" | "offline" */
  availabilityStatus: text("availability_status").notNull().default("available"),
  isVerified: boolean("is_verified").notNull().default(false),
  isPriority: boolean("is_priority").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  reportCount: integer("report_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** "Report incorrect number" submissions from the public directory */
export const emergencyContactReportsTable = pgTable("emergency_contact_reports", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull().references(() => emergencyContactsTable.id, { onDelete: "cascade" }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEmergencyContactSchema = createInsertSchema(emergencyContactsTable).omit({
  id: true, reportCount: true, createdAt: true, updatedAt: true,
});
export const insertEmergencyContactReportSchema = createInsertSchema(emergencyContactReportsTable).omit({
  id: true, createdAt: true,
});

export type EmergencyContact = typeof emergencyContactsTable.$inferSelect;
export type InsertEmergencyContact = z.infer<typeof insertEmergencyContactSchema>;
export type EmergencyContactReport = typeof emergencyContactReportsTable.$inferSelect;
