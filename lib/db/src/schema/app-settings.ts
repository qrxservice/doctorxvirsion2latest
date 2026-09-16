import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  // Admin-level global toggle for prescription QR display. Effective QR on a
  // printout is this AND the per-doctor showQr flag.
  prescriptionQrEnabled: boolean("prescription_qr_enabled").notNull().default(true),
  // Master-admin broadcast notice shown on doctor dashboards.
  noticeText: text("notice_text"),
  noticeEnabled: boolean("notice_enabled").notNull().default(false),
  // Homepage hero background (admin-managed). Object path for the image plus
  // an overlay color + opacity (0-100) to control contrast over the image.
  heroImageUrl: text("hero_image_url"),
  heroOverlayColor: text("hero_overlay_color").notNull().default("#0f172a"),
  heroOverlayOpacity: integer("hero_overlay_opacity").notNull().default(40),
  // Admin-configurable site theme colors (hex). Null/empty = use the built-in
  // default. Applied at runtime by overriding CSS variables for the active
  // light/dark mode. Separate values per mode so each can be tuned.
  themeColorsEnabled: boolean("theme_colors_enabled").notNull().default(false),
  themePrimaryLight: text("theme_primary_light"),
  themePrimaryDark: text("theme_primary_dark"),
  themeBgLight: text("theme_bg_light"),
  themeBgDark: text("theme_bg_dark"),
  doctorCardLight: text("doctor_card_light"),
  doctorCardDark: text("doctor_card_dark"),
  // SMTP email config (admin-managed; falls back to env when null).
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPassword: text("smtp_password"),
  smtpFromEmail: text("smtp_from_email"),
  smtpFromName: text("smtp_from_name"),
  smtpEnabled: boolean("smtp_enabled").notNull().default(false),
  // SMS provider config (admin-managed).
  smsProvider: text("sms_provider"),
  smsApiKey: text("sms_api_key"),
  smsSenderId: text("sms_sender_id"),
  smsEnabled: boolean("sms_enabled").notNull().default(false),
  shopEnabled: boolean("shop_enabled").notNull().default(true),
  // Subscription billing settings
  monthlySubscriptionFee: integer("monthly_subscription_fee").notNull().default(500),
  autoApproveOnPayment: boolean("auto_approve_on_payment").notNull().default(false),
  // Manual payment (bank transfer / cash / offline) is always available as a
  // fallback method alongside the online gateways below.
  manualPaymentEnabled: boolean("manual_payment_enabled").notNull().default(true),
  // Master Admin 2-step verification (login OTP). Method "email" is live now;
  // "mobile" is configurable/future-ready and requires an SMS OTP provider
  // (apiUrl/apiKey) to be set before it can be used.
  admin2faEnabled: boolean("admin_2fa_enabled").notNull().default(false),
  admin2faMethod: text("admin_2fa_method").notNull().default("email"),
  admin2faOtpExpiryMinutes: integer("admin_2fa_otp_expiry_minutes").notNull().default(10),
  admin2faMobileApiUrl: text("admin_2fa_mobile_api_url"),
  admin2faMobileApiKey: text("admin_2fa_mobile_api_key"),
  // Site branding — logo, favicon, footer logo (admin-managed). Object storage
  // paths; null = fall back to the built-in QRX wordmark/icon.
  siteLogoUrl: text("site_logo_url"),
  siteLogoWidth: integer("site_logo_width").notNull().default(32),
  siteLogoHeight: integer("site_logo_height").notNull().default(32),
  faviconUrl: text("favicon_url"),
  footerLogoUrl: text("footer_logo_url"),
  // Footer content — editable text shown in the public site footer.
  // Null values fall back to built-in defaults in the frontend.
  footerSiteName: text("footer_site_name"),
  footerTagline: text("footer_tagline"),
  footerCopyrightText: text("footer_copyright_text"),
  footerAbout: text("footer_about"),
  // Appointment Donation Payment — master toggle + amount + message shown to
  // patients before they confirm booking. Serial number is only generated after
  // the patient completes the donation step. Payment gateway integration is
  // future-ready; this table holds the config, the actual gateway call lives in
  // the frontend payment step.
  donationEnabled: boolean("donation_enabled").notNull().default(false),
  donationAmount: integer("donation_amount").notNull().default(100),
  donationAmountUsd: integer("donation_amount_usd").notNull().default(1),
  donationMessage: text("donation_message"),
  // Multi-currency doctor subscription pricing — admin-configurable tiered
  // fees based on BMDC validity years, one rule set per currency. Tier 1
  // covers 0..tier1MaxYears, tier 2 covers tier1MaxYears..tier2MaxYears, and
  // tier 3 covers everything above tier2MaxYears. Applied automatically to
  // doctor registration (and, via the doctor's stored currency, renewal)
  // based on the country resolved from the requester's IP address.
  bdtTier1MaxYears: integer("bdt_tier1_max_years").notNull().default(5),
  bdtTier1Fee: integer("bdt_tier1_fee").notNull().default(0),
  bdtTier2MaxYears: integer("bdt_tier2_max_years").notNull().default(10),
  bdtTier2Fee: integer("bdt_tier2_fee").notNull().default(500),
  bdtTier3Fee: integer("bdt_tier3_fee").notNull().default(1000),
  usdTier1MaxYears: integer("usd_tier1_max_years").notNull().default(5),
  usdTier1Fee: integer("usd_tier1_fee").notNull().default(0),
  usdTier2MaxYears: integer("usd_tier2_max_years").notNull().default(10),
  usdTier2Fee: integer("usd_tier2_fee").notNull().default(5),
  usdTier3Fee: integer("usd_tier3_fee").notNull().default(10),
  // USD equivalent of monthlySubscriptionFee, used for self-service pay/renew
  // when the doctor's stored billing currency is USD.
  monthlySubscriptionFeeUsd: integer("monthly_subscription_fee_usd").notNull().default(5),
  // Master Admin toggle: when false, doctors cannot create/edit/delete prescription
  // templates. Assistants are always blocked from mutating templates regardless.
  doctorTemplateManagementEnabled: boolean("doctor_template_management_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAppSettingsSchema = createInsertSchema(appSettingsTable).omit({ id: true, updatedAt: true });
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettings = typeof appSettingsTable.$inferSelect;
