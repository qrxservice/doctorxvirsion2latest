import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rxTemplatesTable = pgTable("rx_templates", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id"),
  type: text("type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  department: text("department"),
  isFavorite: boolean("is_favorite").default(false),
  isHidden: boolean("is_hidden").default(false),
  isBuiltin: boolean("is_builtin").default(false),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRxTemplateSchema = createInsertSchema(rxTemplatesTable).omit({ id: true, createdAt: true });
export type InsertRxTemplate = z.infer<typeof insertRxTemplateSchema>;
export type RxTemplate = typeof rxTemplatesTable.$inferSelect;
