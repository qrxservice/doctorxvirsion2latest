import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

// Records every online gateway checkout attempt (currently SSLCommerz) so
// payments can be reconciled and subscriptions activated only after the
// gateway confirms success. One row per transaction id (tran_id).
export const paymentTransactionsTable = pgTable("payment_transactions", {
  id: serial("id").primaryKey(),
  gateway: text("gateway").notNull(),
  tranId: text("tran_id").notNull().unique(),
  purpose: text("purpose").notNull().default("doctor_subscription"), // "doctor_subscription" | "shop_order" | "banner_ad"
  subscriptionId: integer("subscription_id"),
  doctorId: integer("doctor_id"),
  orderId: integer("order_id"),
  months: integer("months"),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("BDT"),
  status: text("status").notNull().default("initiated"), // "initiated" | "success" | "failed" | "cancelled"
  gatewayValId: text("gateway_val_id"),
  gatewayResponse: text("gateway_response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PaymentTransaction = typeof paymentTransactionsTable.$inferSelect;
