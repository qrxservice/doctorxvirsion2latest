import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

// Config-only payment gateway records. No live API calls are made yet — these
// fields exist so the gateways can be wired up later for doctor subscription,
// shop order, and banner/ad payments without another schema migration.
export const PAYMENT_GATEWAYS = [
  "sslcommerz",
  "shurjopay",
  "aamarpay",
  "bkash",
  "nagad",
  "rocket",
  "bangla_qr",
] as const;

export type PaymentGatewayKey = (typeof PAYMENT_GATEWAYS)[number];

export const paymentGatewaysTable = pgTable("payment_gateways", {
  id: serial("id").primaryKey(),
  gateway: text("gateway").notNull().unique(),
  enabled: boolean("enabled").notNull().default(false),
  apiKey: text("api_key"),
  secretKey: text("secret_key"),
  merchantId: text("merchant_id"),
  mode: text("mode").notNull().default("sandbox"), // "sandbox" | "live"
  successUrl: text("success_url"),
  failedUrl: text("failed_url"),
  callbackUrl: text("callback_url"),
  // Bangla QR-specific config (only used when gateway = "bangla_qr")
  qrImageUrl: text("qr_image_url"),         // object storage path for the scannable QR image
  merchantName: text("merchant_name"),       // displayed under the QR at checkout
  paymentInstructions: text("payment_instructions"), // short guide shown at checkout
  successMessage: text("success_message"),   // shown after payment confirmed
  failureMessage: text("failure_message"),   // shown on failure / timeout
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type PaymentGateway = typeof paymentGatewaysTable.$inferSelect;
