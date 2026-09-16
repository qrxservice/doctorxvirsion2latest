import { pgTable, text, serial, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const doctorAvailabilityTable = pgTable("doctor_availability", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  breakStart: text("break_start"),
  breakEnd: text("break_end"),
  maxAppointments: integer("max_appointments").default(20),
  isAvailable: boolean("is_available").default(true),
});

export const insertDoctorAvailabilitySchema = createInsertSchema(doctorAvailabilityTable).omit({ id: true });
export type InsertDoctorAvailability = z.infer<typeof insertDoctorAvailabilitySchema>;
export type DoctorAvailability = typeof doctorAvailabilityTable.$inferSelect;
