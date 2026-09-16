import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const menuItemsTable = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  // English title (required)
  label: text("label").notNull(),
  // Bangla title (optional, falls back to label)
  titleBn: text("title_bn"),
  url: text("url").notNull().default("#"),
  // header | footer | both | hidden
  location: text("location").notNull().default("header"),
  // Footer column grouping: quick-links | services | resources | legal | contact
  footerGroup: text("footer_group"),
  // internal | external | custom | category | blog | tool
  menuType: text("menu_type").notNull().default("custom"),
  // public | logged-in | doctor | assistant | admin
  visibility: text("visibility").notNull().default("public"),
  // Self-referential parent for nested menus (null = top-level)
  parentId: integer("parent_id"),
  displayOrder: integer("display_order").notNull().default(0),
  openInNewTab: boolean("open_in_new_tab").notNull().default(false),
  isNoFollow: boolean("is_no_follow").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMenuItemSchema = createInsertSchema(menuItemsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;
export type MenuItem = typeof menuItemsTable.$inferSelect;
