import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const patientReviewsTable = pgTable("patient_reviews", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull(),
  appointmentId: integer("appointment_id"),
  patientName: text("patient_name").notNull(),
  patientPhone: text("patient_phone"),
  rating: integer("rating").notNull(),
  reviewText: text("review_text"),
  isApproved: boolean("is_approved").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPatientReviewSchema = createInsertSchema(patientReviewsTable).omit({ id: true, createdAt: true });
export type InsertPatientReview = z.infer<typeof insertPatientReviewSchema>;
export type PatientReview = typeof patientReviewsTable.$inferSelect;
