import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const appointmentsTable = pgTable("appointments", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull(),
  patientName: text("patient_name").notNull(),
  patientPhone: text("patient_phone").notNull(),
  patientEmail: text("patient_email"),
  patientAge: integer("patient_age"),
  patientGender: text("patient_gender"),
  complaint: text("complaint"),
  bp: text("bp"),
  pulse: text("pulse"),
  temp: text("temp"),
  weight: text("weight"),
  height: text("height"),
  hb: text("hb"),
  sugar: text("sugar"),
  spo2: text("spo2"),
  medicalHistory: text("medical_history"),
  notes: text("notes"),
  labReportUrl: text("lab_report_url"),
  prescriptionUploadUrl: text("prescription_upload_url"),
  bookingSource: text("booking_source").notNull().default("online"),
  appointmentDate: text("appointment_date").notNull(),
  appointmentTime: text("appointment_time"),
  serialNo: integer("serial_no").notNull(),
  status: text("status").notNull().default("pending"),
  trackingToken: text("tracking_token"),
  confirmationEmailSent: boolean("confirmation_email_sent").default(false),
  confirmationSmsStatus: text("confirmation_sms_status").default("pending"),
  // Appointment Donation Payment — captured at booking time from the
  // app-settings donation config that was active then, so historical records
  // stay accurate even if the admin later changes the amount or disables it.
  donationPaid: boolean("donation_paid").notNull().default(false),
  donationAmount: integer("donation_amount"),
  donationCurrency: text("donation_currency"),
  donationPaidAt: timestamp("donation_paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAppointmentSchema = createInsertSchema(appointmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointmentsTable.$inferSelect;
