import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name"),
  role: text("role").notNull().default("patient"),
  doctorId: integer("doctor_id"),
  phone: text("phone"),
  dateOfBirth: text("date_of_birth"),
  gender: text("gender"),
  bloodGroup: text("blood_group"),
  address: text("address"),
  country: text("country"),
  division: text("division"),
  district: text("district"),
  area: text("area"),
  profilePicture: text("profile_picture"),
  emergencyContact: text("emergency_contact"),
  nationality: text("nationality"),
  preferredLanguage: text("preferred_language"),
  // Blood donor fields
  isDonor: text("is_donor").default("false"), // "true" | "false"
  donorStatus: text("donor_status").default("inactive"), // available | temporarily_unavailable | inactive
  lastDonationDate: text("last_donation_date"),
  // JSON permissions object for assistant accounts, e.g. {"canViewTemplates":true}
  permissions: text("permissions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
