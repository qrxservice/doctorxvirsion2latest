import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const slidersTable = pgTable("sliders", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  imageUrl: text("image_url"),
  linkUrl: text("link_url"),
  buttonText: text("button_text"),
  description: text("description"),
  // Placement on homepage: hero | full_width | boxed | middle | before_footer
  position: text("position").notNull().default("hero"),
  isActive: boolean("is_active").notNull().default(true),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  priority: integer("priority").notNull().default(0),
  displayOrder: integer("display_order").notNull().default(0),
  // Slider controls
  autoPlay: boolean("auto_play").notNull().default(true),
  slideInterval: integer("slide_interval").notNull().default(5000),
  showArrows: boolean("show_arrows").notNull().default(true),
  showDots: boolean("show_dots").notNull().default(true),
  // Size customization (px)
  desktopWidth: integer("desktop_width"),
  desktopHeight: integer("desktop_height"),
  mobileWidth: integer("mobile_width"),
  mobileHeight: integer("mobile_height"),
  tabletWidth: integer("tablet_width"),
  tabletHeight: integer("tablet_height"),
  customWidth: integer("custom_width"),
  customHeight: integer("custom_height"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSliderSchema = createInsertSchema(slidersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSlider = z.infer<typeof insertSliderSchema>;
export type Slider = typeof slidersTable.$inferSelect;
