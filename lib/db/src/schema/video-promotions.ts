import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const videoPromotionsTable = pgTable("video_promotions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  videoUrl: text("video_url"),
  thumbnailUrl: text("thumbnail_url"),
  // homepage_hero | homepage_middle | before_footer | doctor_registration
  position: text("position").notNull().default("homepage_hero"),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  priority: integer("priority").notNull().default(0),
  // Size customization (px; null = auto/100%)
  desktopWidth: integer("desktop_width"),
  desktopHeight: integer("desktop_height"),
  mobileWidth: integer("mobile_width"),
  mobileHeight: integer("mobile_height"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVideoPromotionSchema = createInsertSchema(videoPromotionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVideoPromotion = z.infer<typeof insertVideoPromotionSchema>;
export type VideoPromotion = typeof videoPromotionsTable.$inferSelect;
