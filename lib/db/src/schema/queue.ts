import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const queueEntriesTable = pgTable("queue_entries", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull(),
  appointmentId: integer("appointment_id"),
  patientName: text("patient_name").notNull(),
  patientPhone: text("patient_phone"),
  serialNo: integer("serial_no").notNull(),
  status: text("status").notNull().default("waiting"),
  queueDate: text("queue_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertQueueEntrySchema = createInsertSchema(queueEntriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertQueueEntry = z.infer<typeof insertQueueEntrySchema>;
export type QueueEntry = typeof queueEntriesTable.$inferSelect;
