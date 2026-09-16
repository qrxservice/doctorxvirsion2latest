import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";
import { getActor, writeAudit } from "../lib/admin";

const router: IRouter = Router();

async function ensureAppSettings() {
  const [existing] = await db.select().from(appSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(appSettingsTable).values({}).returning();
  return created;
}

// Shape returned to the admin UI — secrets (smtpPassword, smsApiKey) are masked.
function publicShape(s: typeof appSettingsTable.$inferSelect) {
  return {
    prescriptionQrEnabled: s.prescriptionQrEnabled,
    smtpHost: s.smtpHost ?? null,
    smtpPort: s.smtpPort ?? null,
    smtpUser: s.smtpUser ?? null,
    smtpFromEmail: s.smtpFromEmail ?? null,
    smtpFromName: s.smtpFromName ?? null,
    smtpEnabled: s.smtpEnabled,
    smsProvider: s.smsProvider ?? null,
    smsSenderId: s.smsSenderId ?? null,
    smsEnabled: s.smsEnabled,
    smtpConfigured: !!(s.smtpHost && s.smtpUser && s.smtpPassword),
    smsConfigured: !!(s.smsProvider && s.smsApiKey),
    monthlySubscriptionFee: s.monthlySubscriptionFee,
    monthlySubscriptionFeeUsd: s.monthlySubscriptionFeeUsd,
    autoApproveOnPayment: s.autoApproveOnPayment,
    manualPaymentEnabled: s.manualPaymentEnabled,
    bdtTier1MaxYears: s.bdtTier1MaxYears,
    bdtTier1Fee: s.bdtTier1Fee,
    bdtTier2MaxYears: s.bdtTier2MaxYears,
    bdtTier2Fee: s.bdtTier2Fee,
    bdtTier3Fee: s.bdtTier3Fee,
    usdTier1MaxYears: s.usdTier1MaxYears,
    usdTier1Fee: s.usdTier1Fee,
    usdTier2MaxYears: s.usdTier2MaxYears,
    usdTier2Fee: s.usdTier2Fee,
    usdTier3Fee: s.usdTier3Fee,
    admin2faEnabled: s.admin2faEnabled,
    admin2faMethod: s.admin2faMethod,
    admin2faOtpExpiryMinutes: s.admin2faOtpExpiryMinutes,
    admin2faMobileApiUrl: s.admin2faMobileApiUrl ?? null,
    admin2faMobileConfigured: !!(s.admin2faMobileApiUrl && s.admin2faMobileApiKey),
    donationEnabled: s.donationEnabled,
    donationAmount: s.donationAmount,
    donationAmountUsd: s.donationAmountUsd,
    donationMessage: s.donationMessage ?? null,
  };
}

router.get("/admin/settings", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const settings = await ensureAppSettings();
  res.json(publicShape(settings));
});

router.put("/admin/settings", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const current = await ensureAppSettings();
  const b = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (typeof b.prescriptionQrEnabled === "boolean") updates.prescriptionQrEnabled = b.prescriptionQrEnabled;
  if (b.smtpHost !== undefined) updates.smtpHost = b.smtpHost || null;
  if (b.smtpPort !== undefined) updates.smtpPort = b.smtpPort ? parseInt(String(b.smtpPort)) : null;
  if (b.smtpUser !== undefined) updates.smtpUser = b.smtpUser || null;
  // Only overwrite secret when a non-empty value is provided.
  if (b.smtpPassword) updates.smtpPassword = b.smtpPassword;
  if (b.smtpFromEmail !== undefined) updates.smtpFromEmail = b.smtpFromEmail || null;
  if (b.smtpFromName !== undefined) updates.smtpFromName = b.smtpFromName || null;
  if (typeof b.smtpEnabled === "boolean") updates.smtpEnabled = b.smtpEnabled;
  if (b.smsProvider !== undefined) updates.smsProvider = b.smsProvider || null;
  if (b.smsApiKey) updates.smsApiKey = b.smsApiKey;
  if (b.smsSenderId !== undefined) updates.smsSenderId = b.smsSenderId || null;
  if (typeof b.smsEnabled === "boolean") updates.smsEnabled = b.smsEnabled;
  // Subscription billing settings
  if (b.monthlySubscriptionFee !== undefined && Number.isFinite(Number(b.monthlySubscriptionFee))) {
    updates.monthlySubscriptionFee = Number(b.monthlySubscriptionFee);
  }
  if (b.monthlySubscriptionFeeUsd !== undefined && Number.isFinite(Number(b.monthlySubscriptionFeeUsd))) {
    updates.monthlySubscriptionFeeUsd = Math.max(0, Number(b.monthlySubscriptionFeeUsd));
  }
  if (typeof b.autoApproveOnPayment === "boolean") updates.autoApproveOnPayment = b.autoApproveOnPayment;
  if (typeof b.manualPaymentEnabled === "boolean") updates.manualPaymentEnabled = b.manualPaymentEnabled;
  // Doctor registration tiered pricing (by BMDC validity years), per currency
  for (const key of [
    "bdtTier1MaxYears", "bdtTier1Fee", "bdtTier2MaxYears", "bdtTier2Fee", "bdtTier3Fee",
    "usdTier1MaxYears", "usdTier1Fee", "usdTier2MaxYears", "usdTier2Fee", "usdTier3Fee",
  ] as const) {
    if (b[key] !== undefined && Number.isFinite(Number(b[key]))) {
      updates[key] = Math.max(0, Number(b[key]));
    }
  }
  // Validate that tier thresholds are ordered (tier1 < tier2) for each currency.
  // Merge incoming values with current so partial saves are validated correctly.
  const bdtT1 = Number(updates.bdtTier1MaxYears ?? current.bdtTier1MaxYears);
  const bdtT2 = Number(updates.bdtTier2MaxYears ?? current.bdtTier2MaxYears);
  const usdT1 = Number(updates.usdTier1MaxYears ?? current.usdTier1MaxYears);
  const usdT2 = Number(updates.usdTier2MaxYears ?? current.usdTier2MaxYears);
  if (bdtT1 >= bdtT2) {
    res.status(400).json({ error: "BDT tier 1 max years must be less than tier 2 max years." });
    return;
  }
  if (usdT1 >= usdT2) {
    res.status(400).json({ error: "USD tier 1 max years must be less than tier 2 max years." });
    return;
  }
  // Master Admin 2-step verification
  if (typeof b.admin2faEnabled === "boolean") updates.admin2faEnabled = b.admin2faEnabled;
  if (b.admin2faMethod === "email" || b.admin2faMethod === "mobile") updates.admin2faMethod = b.admin2faMethod;
  if (b.admin2faOtpExpiryMinutes !== undefined && Number.isFinite(Number(b.admin2faOtpExpiryMinutes))) {
    updates.admin2faOtpExpiryMinutes = Math.min(60, Math.max(1, Number(b.admin2faOtpExpiryMinutes)));
  }
  if (b.admin2faMobileApiUrl !== undefined) updates.admin2faMobileApiUrl = b.admin2faMobileApiUrl || null;
  if (b.admin2faMobileApiKey) updates.admin2faMobileApiKey = b.admin2faMobileApiKey;
  // Appointment Donation Payment settings
  if (typeof b.donationEnabled === "boolean") updates.donationEnabled = b.donationEnabled;
  if (b.donationAmount !== undefined && Number.isFinite(Number(b.donationAmount))) {
    updates.donationAmount = Math.max(0, Number(b.donationAmount));
  }
  if (b.donationAmountUsd !== undefined && Number.isFinite(Number(b.donationAmountUsd))) {
    updates.donationAmountUsd = Math.max(0, Number(b.donationAmountUsd));
  }
  if (b.donationMessage !== undefined) updates.donationMessage = b.donationMessage || null;

  const [settings] = await db.update(appSettingsTable).set(updates)
    .where(eq(appSettingsTable.id, current.id)).returning();
  await writeAudit(actor, "update", "settings", current.id);
  res.json(publicShape(settings));
});

export default router;
