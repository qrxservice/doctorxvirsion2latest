import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const ADSENSE_POSITIONS = [
  "homepage_hero",
  "homepage_middle",
  "homepage_bottom",
  "doctor_listing",
  "doctor_detail",
  "blog_detail",
  "sidebar",
] as const;

export type AdsensePosition = (typeof ADSENSE_POSITIONS)[number];

export const adsenseSlotsTable = pgTable("adsense_slots", {
  id: serial("id").primaryKey(),
  position: text("position").notNull().unique(),
  code: text("code").notNull().default(""),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type AdsenseSlot = typeof adsenseSlotsTable.$inferSelect;
