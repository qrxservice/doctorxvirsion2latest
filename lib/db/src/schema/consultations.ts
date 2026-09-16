import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const doctorConsultationsTable = pgTable("doctor_consultations", {
  id: serial("id").primaryKey(),
  requesterDoctorId: integer("requester_doctor_id").notNull(),
  consultantDoctorId: integer("consultant_doctor_id").notNull(),
  patientInfo: text("patient_info"),
  caseNotes: text("case_notes").notNull(),
  attachmentUrl: text("attachment_url"),
  attachmentType: text("attachment_type"),
  attachmentName: text("attachment_name"),
  attachmentSize: integer("attachment_size"),
  responseNotes: text("response_notes"),
  status: text("status").notNull().default("pending"), // pending | reviewed | closed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDoctorConsultationSchema = createInsertSchema(doctorConsultationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDoctorConsultation = z.infer<typeof insertDoctorConsultationSchema>;
export type DoctorConsultation = typeof doctorConsultationsTable.$inferSelect;
