import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const advertisementsTable = pgTable("advertisements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  imageUrl: text("image_url").notNull(),
  linkUrl: text("link_url"),
  // homepage_hero | homepage_middle | homepage_bottom | doctors_listing | doctor_detail | shop | blog
  location: text("location").notNull().default("homepage_middle"),
  customWidth: integer("custom_width"),
  customHeight: integer("custom_height"),
  desktopWidth: integer("desktop_width"),
  desktopHeight: integer("desktop_height"),
  mobileWidth: integer("mobile_width"),
  mobileHeight: integer("mobile_height"),
  targetCountries: text("target_countries"),
  targetDivisions: text("target_divisions"),
  priority: integer("priority").notNull().default(0),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  // Analytics counters
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAdvertisementSchema = createInsertSchema(advertisementsTable).omit({ id: true, createdAt: true, updatedAt: true, impressions: true, clicks: true });
export type InsertAdvertisement = z.infer<typeof insertAdvertisementSchema>;
export type Advertisement = typeof advertisementsTable.$inferSelect;
