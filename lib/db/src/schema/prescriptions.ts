import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const prescriptionsTable = pgTable("prescriptions", {
  id: serial("id").primaryKey(),
  referenceNo: text("reference_no"),
  status: text("status").notNull().default("final"),
  doctorId: integer("doctor_id").notNull(),
  appointmentId: integer("appointment_id"),
  patientName: text("patient_name").notNull(),
  patientPhone: text("patient_phone"),
  patientAge: integer("patient_age"),
  patientGender: text("patient_gender"),
  patientWeight: text("patient_weight"),
  patientHeight: text("patient_height"),
  chiefComplaint: text("chief_complaint"),
  vitals: text("vitals"),
  examination: text("examination"),
  diagnosis: text("diagnosis"),
  investigations: text("investigations"),
  advice: text("advice"),
  followUpDate: text("follow_up_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const prescriptionItemsTable = pgTable("prescription_items", {
  id: serial("id").primaryKey(),
  prescriptionId: integer("prescription_id").notNull(),
  medicineId: integer("medicine_id"),
  medicineName: text("medicine_name").notNull(),
  genericName: text("generic_name"),
  strength: text("strength"),
  dosageForm: text("dosage_form"),
  dose: text("dose"),
  duration: text("duration"),
  mealTiming: text("meal_timing"),
  instruction: text("instruction"),
});

export const insertPrescriptionSchema = createInsertSchema(prescriptionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPrescription = z.infer<typeof insertPrescriptionSchema>;
export type Prescription = typeof prescriptionsTable.$inferSelect;

export const insertPrescriptionItemSchema = createInsertSchema(prescriptionItemsTable).omit({ id: true });
export type InsertPrescriptionItem = z.infer<typeof insertPrescriptionItemSchema>;
export type PrescriptionItem = typeof prescriptionItemsTable.$inferSelect;
