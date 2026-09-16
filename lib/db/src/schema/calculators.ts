import { pgTable, text, serial, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const calculatorsTable = pgTable("calculators", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  category: text("category").notNull().default("general"),
  shortDescription: text("short_description"),
  content: text("content").notNull().default(""),
  featuredImageUrl: text("featured_image_url"),
  seoTitle: text("seo_title"),
  metaDescription: text("meta_description"),
  status: text("status").notNull().default("draft"),
  schemaEnabled: boolean("schema_enabled").notNull().default(false),
  // JSON arrays stored as jsonb for flexibility
  fieldsJson: jsonb("fields_json").notNull().default([]),
  formulasJson: jsonb("formulas_json").notNull().default([]),
  resultsJson: jsonb("results_json").notNull().default([]),
  faqsJson: jsonb("faqs_json").notNull().default([]),
  placementsJson: jsonb("placements_json").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCalculatorSchema = createInsertSchema(calculatorsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCalculator = z.infer<typeof insertCalculatorSchema>;
export type Calculator = typeof calculatorsTable.$inferSelect;
