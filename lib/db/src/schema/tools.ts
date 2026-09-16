import { pgTable, text, serial, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** Tool categories — admin-managed, extensible. */
export const toolCategoriesTable = pgTable("tool_categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Tools — the core table for QRX Tools Management.
 * `type` is a free-form text field so new tool types can be added without a schema change.
 * HTML / CSS / JS are stored separately to allow tab-based editing and selective sandboxing.
 */
export const toolsTable = pgTable("tools", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Free-form: "medical-calculator" | "html-tool" | "css-tool" | "js-tool" | "medical-widget" | "interactive-form" | "mini-app" | any future type */
  type: text("type").notNull().default("html-tool"),
  categoryId: integer("category_id").references(() => toolCategoriesTable.id, { onDelete: "set null" }),
  /** "all" means available to all departments; otherwise a department name */
  department: text("department").notNull().default("all"),
  shortDescription: text("short_description"),
  featuredImageUrl: text("featured_image_url"),
  icon: text("icon"),
  /** "draft" | "published" */
  status: text("status").notNull().default("draft"),
  version: text("version").notNull().default("1.0"),
  htmlCode: text("html_code").notNull().default(""),
  cssCode: text("css_code").notNull().default(""),
  jsCode: text("js_code").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/** Doctor personal favorites */
export const toolFavoritesTable = pgTable("tool_favorites", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull(),
  toolId: integer("tool_id").notNull().references(() => toolsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("tool_favorites_doctor_tool_idx").on(t.doctorId, t.toolId),
]);

/** Recently used tools per doctor — upsert usedAt to track recency */
export const toolUsageTable = pgTable("tool_usage", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull(),
  toolId: integer("tool_id").notNull().references(() => toolsTable.id, { onDelete: "cascade" }),
  usedAt: timestamp("used_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("tool_usage_doctor_tool_idx").on(t.doctorId, t.toolId),
]);

export const insertToolSchema = createInsertSchema(toolsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertToolCategorySchema = createInsertSchema(toolCategoriesTable).omit({ id: true, createdAt: true });

export type Tool = typeof toolsTable.$inferSelect;
export type InsertTool = z.infer<typeof insertToolSchema>;
export type ToolCategory = typeof toolCategoriesTable.$inferSelect;
export type ToolFavorite = typeof toolFavoritesTable.$inferSelect;
export type ToolUsage = typeof toolUsageTable.$inferSelect;
