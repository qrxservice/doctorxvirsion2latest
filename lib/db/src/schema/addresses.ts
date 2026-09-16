import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const userAddressesTable = pgTable("user_addresses", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  label: text("label").notNull().default("Home"),
  recipientName: text("recipient_name").notNull(),
  phone: text("phone").notNull(),
  altPhone: text("alt_phone"),
  country: text("country"),
  division: text("division"),
  district: text("district"),
  upazila: text("upazila"),
  postalCode: text("postal_code"),
  fullAddress: text("full_address").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserAddressSchema = createInsertSchema(userAddressesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserAddress = z.infer<typeof insertUserAddressSchema>;
export type UserAddress = typeof userAddressesTable.$inferSelect;
