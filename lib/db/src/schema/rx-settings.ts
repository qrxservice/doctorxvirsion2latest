import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const doctorRxSettingsTable = pgTable("doctor_rx_settings", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull().unique(),
  // Header settings
  headerName: text("header_name"),
  headerDegree: text("header_degree"),
  headerDesignation: text("header_designation"),
  headerBmdc: text("header_bmdc"),
  hospitalName: text("hospital_name"),
  headerAddress: text("header_address"),
  headerPhone: text("header_phone"),
  headerEmail: text("header_email"),
  signatureText: text("signature_text"),
  signatureImage: text("signature_image"),
  // Page setup
  pageSize: text("page_size").notNull().default("A4"),
  marginTop: integer("margin_top").notNull().default(15),
  marginRight: integer("margin_right").notNull().default(15),
  marginBottom: integer("margin_bottom").notNull().default(15),
  marginLeft: integer("margin_left").notNull().default(15),
  headerHeight: integer("header_height").notNull().default(25),
  footerHeight: integer("footer_height").notNull().default(15),
  showHeader: boolean("show_header").notNull().default(true),
  showQr: boolean("show_qr").notNull().default(true),
  showSignature: boolean("show_signature").notNull().default(true),
  showFooter: boolean("show_footer").notNull().default(true),
  footerText: text("footer_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDoctorRxSettingsSchema = createInsertSchema(doctorRxSettingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDoctorRxSettings = z.infer<typeof insertDoctorRxSettingsSchema>;
export type DoctorRxSettings = typeof doctorRxSettingsTable.$inferSelect;
