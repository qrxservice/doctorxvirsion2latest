import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  doctorId: integer("doctor_id").notNull(),
  bmdcValidityYears: integer("bmdc_validity_years"),
  fee: integer("fee").notNull().default(0),
  months: integer("months"),
  monthlyFee: integer("monthly_fee"),
  // Billing currency for this subscription — mirrors the doctor's currency.
  currency: text("currency").notNull().default("BDT"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  status: text("status").notNull().default("inactive"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
