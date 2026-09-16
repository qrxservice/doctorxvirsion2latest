import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const patientReferralsTable = pgTable("patient_referrals", {
  id: serial("id").primaryKey(),
  referrerDoctorId: integer("referrer_doctor_id").notNull(),
  receiverDoctorId: integer("receiver_doctor_id").notNull(),
  patientName: text("patient_name").notNull(),
  patientPhone: text("patient_phone"),
  patientAge: integer("patient_age"),
  patientGender: text("patient_gender"),
  referralReason: text("referral_reason").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("pending"), // pending | reviewed | closed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPatientReferralSchema = createInsertSchema(patientReferralsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPatientReferral = z.infer<typeof insertPatientReferralSchema>;
export type PatientReferral = typeof patientReferralsTable.$inferSelect;
