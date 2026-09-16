import { pgTable, text, serial, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const departmentsTable = pgTable("departments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
  description: text("description"),
});

export const insertDepartmentSchema = createInsertSchema(departmentsTable).omit({ id: true });
export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;
export type Department = typeof departmentsTable.$inferSelect;

export const specialtiesTable = pgTable("specialties", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  departmentId: integer("department_id"),
});

export const insertSpecialtySchema = createInsertSchema(specialtiesTable).omit({ id: true });
export type InsertSpecialty = z.infer<typeof insertSpecialtySchema>;
export type Specialty = typeof specialtiesTable.$inferSelect;

export const locationsTable = pgTable("locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  district: text("district"),
  division: text("division"),
  upazila: text("upazila"),
  locationType: text("location_type"),
});

export const insertLocationSchema = createInsertSchema(locationsTable).omit({ id: true });
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locationsTable.$inferSelect;
