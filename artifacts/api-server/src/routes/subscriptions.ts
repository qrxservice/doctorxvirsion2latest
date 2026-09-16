import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, subscriptionsTable, doctorsTable, usersTable, appSettingsTable } from "@workspace/db";
import { verifyAuthToken } from "../lib/token";
import { getMonthlySubscriptionFee, type Currency } from "../lib/currency";

const router: IRouter = Router();

const PAYMENT_STATUSES = ["free", "paid", "unpaid", "expired"] as const;
const STATUSES = ["active", "inactive", "expired"] as const;

async function getRole(auth: string | undefined): Promise<string | null> {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    // Trust the persisted role, not the token's role claim.
    return user?.role ?? null;
  } catch { return null; }
}

async function getUser(auth: string | undefined) {
  const claims = verifyAuthToken(auth);
  if (!claims) return null;
  try {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
    return user ?? null;
  } catch { return null; }
}

/** Monthly fee for a doctor's own billing currency (stored at registration),
 *  not the requester's current IP — this keeps a doctor's billing rate
 *  stable regardless of where they connect from later. */
async function getMonthlyFee(currency: Currency = "BDT"): Promise<number> {
  try {
    const [settings] = await db.select().from(appSettingsTable).limit(1);
    if (!settings) return currency === "BDT" ? 500 : 5;
    return getMonthlySubscriptionFee(currency, settings);
  } catch { return currency === "BDT" ? 500 : 5; }
}

async function getAutoApprove(): Promise<boolean> {
  try {
    const [settings] = await db.select().from(appSettingsTable).limit(1);
    return settings?.autoApproveOnPayment ?? false;
  } catch { return false; }
}

/** Extend date string by N months, returning yyyy-mm-dd */
function addMonths(dateStr: string | null | undefined, months: number): string {
  const base = dateStr && dateStr >= new Date().toISOString().split("T")[0]
    ? new Date(dateStr)
    : new Date();
  base.setMonth(base.getMonth() + months);
  return base.toISOString().split("T")[0];
}

async function enrichSub(s: typeof subscriptionsTable.$inferSelect) {
  const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, s.doctorId));
  return {
    ...s,
    doctorName: doc?.name ?? null,
    doctorRegisteredAt: doc?.createdAt?.toISOString() ?? null,
  };
}

router.get("/subscriptions", async (req, res): Promise<void> => {
  if (await getRole(req.headers.authorization) !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const { status, doctorId } = req.query as Record<string, string>;
  let all = await db.select().from(subscriptionsTable);
  if (status) all = all.filter(s => s.status === status || s.paymentStatus === status);
  if (doctorId) all = all.filter(s => s.doctorId === parseInt(doctorId));

  const enriched = await Promise.all(all.map(enrichSub));
  res.json(enriched);
});

/** POST /subscriptions/pay — record payment for a doctor's subscription.
 *  Admin-only. Calculates fee = months × monthlyFee, sets start/end dates,
 *  activates subscription, and optionally auto-approves the doctor. */
router.post("/subscriptions/pay", async (req, res): Promise<void> => {
  if (await getRole(req.headers.authorization) !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const rawDoctorId = Number(req.body?.doctorId);
  const rawMonths = Number(req.body?.months);
  const rawFeeOverride = req.body?.monthlyFeeOverride !== undefined ? Number(req.body.monthlyFeeOverride) : undefined;

  if (!Number.isInteger(rawDoctorId) || rawDoctorId < 1) {
    res.status(400).json({ error: "doctorId must be a positive integer" }); return;
  }
  if (!Number.isInteger(rawMonths) || rawMonths < 1 || rawMonths > 120) {
    res.status(400).json({ error: "months must be an integer between 1 and 120" }); return;
  }
  if (rawFeeOverride !== undefined && (!Number.isFinite(rawFeeOverride) || rawFeeOverride < 0)) {
    res.status(400).json({ error: "monthlyFeeOverride must be a non-negative number" }); return;
  }

  const doctorId = rawDoctorId;
  const months = rawMonths;

  // Select the most recent subscription for this doctor to avoid ambiguity
  const allSubs = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.doctorId, doctorId));
  const existing = allSubs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (!existing) { res.status(404).json({ error: "Subscription not found" }); return; }

  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
  const currency = doctor?.currency === "USD" ? "USD" : "BDT";
  const monthlyFee = rawFeeOverride ?? (await getMonthlyFee(currency));
  const totalFee = monthlyFee * months;
  const today = new Date().toISOString().split("T")[0];
  const endDate = addMonths(existing.endDate, months);

  const [sub] = await db.update(subscriptionsTable).set({
    months,
    monthlyFee,
    fee: totalFee,
    currency,
    paymentStatus: "paid",
    status: "active",
    startDate: today,
    endDate,
  }).where(eq(subscriptionsTable.id, existing.id)).returning();

  // Auto-approve doctor if the setting is on
  const autoApprove = await getAutoApprove();
  if (autoApprove) {
    await db.update(doctorsTable).set({ approvalStatus: "approved", isVerified: true }).where(eq(doctorsTable.id, doctorId));
  }

  res.json(await enrichSub(sub));
});

router.patch("/subscriptions/:id", async (req, res): Promise<void> => {
  if (await getRole(req.headers.authorization) !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const { paymentStatus, status, startDate, endDate } = req.body;
  const updates: Record<string, unknown> = {};
  if (paymentStatus !== undefined) {
    if (!PAYMENT_STATUSES.includes(paymentStatus)) { res.status(400).json({ error: "Invalid paymentStatus" }); return; }
    updates.paymentStatus = paymentStatus;
  }
  if (status !== undefined) {
    if (!STATUSES.includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
    updates.status = status;
  }
  if (startDate !== undefined) updates.startDate = startDate;
  if (endDate !== undefined) updates.endDate = endDate;
  const [sub] = await db.update(subscriptionsTable).set(updates).where(eq(subscriptionsTable.id, id)).returning();
  if (!sub) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await enrichSub(sub));
});

/** POST /subscriptions/:id/renew — extend an existing subscription by N months.
 *  Admin-only. Calculates new endDate from current endDate (or today if expired). */
router.post("/subscriptions/:id/renew", async (req, res): Promise<void> => {
  if (await getRole(req.headers.authorization) !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Invalid subscription id" }); return; }

  const rawMonths = Number(req.body?.months);
  const rawFeeOverride = req.body?.monthlyFeeOverride !== undefined ? Number(req.body.monthlyFeeOverride) : undefined;

  if (!Number.isInteger(rawMonths) || rawMonths < 1 || rawMonths > 120) {
    res.status(400).json({ error: "months must be an integer between 1 and 120" }); return;
  }
  if (rawFeeOverride !== undefined && (!Number.isFinite(rawFeeOverride) || rawFeeOverride < 0)) {
    res.status(400).json({ error: "monthlyFeeOverride must be a non-negative number" }); return;
  }

  const months = rawMonths;
  const [existing] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Subscription not found" }); return; }

  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, existing.doctorId));
  const currency = doctor?.currency === "USD" ? "USD" : "BDT";
  const monthlyFee = rawFeeOverride ?? (await getMonthlyFee(currency));
  const totalFee = monthlyFee * months;
  const today = new Date().toISOString().split("T")[0];
  const newEndDate = addMonths(existing.endDate, months);

  const [sub] = await db.update(subscriptionsTable).set({
    months,
    monthlyFee,
    fee: totalFee,
    currency,
    paymentStatus: "paid",
    status: "active",
    startDate: existing.startDate ?? today,
    endDate: newEndDate,
  }).where(eq(subscriptionsTable.id, id)).returning();

  res.json(await enrichSub(sub));
});

export default router;
