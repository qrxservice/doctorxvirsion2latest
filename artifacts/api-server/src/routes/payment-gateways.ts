import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, paymentGatewaysTable, PAYMENT_GATEWAYS, type PaymentGatewayKey } from "@workspace/db";
import { getActor, writeAudit } from "../lib/admin";

const router: IRouter = Router();

/**
 * Seed all gateway rows once at startup so the admin UI always has a full,
 * stable set of rows to render/edit.
 */
async function seedGateways() {
  await db
    .insert(paymentGatewaysTable)
    .values(PAYMENT_GATEWAYS.map(gateway => ({ gateway })))
    .onConflictDoNothing();
}

seedGateways().catch((err) => {
  console.error("Failed to seed payment_gateways:", err);
});

// Shape returned to the admin UI — secrets are masked with a "configured" flag.
function serialize(g: typeof paymentGatewaysTable.$inferSelect) {
  return {
    id: g.id,
    gateway: g.gateway,
    enabled: g.enabled,
    apiKey: g.apiKey ?? null,
    merchantId: g.merchantId ?? null,
    mode: g.mode,
    successUrl: g.successUrl ?? null,
    failedUrl: g.failedUrl ?? null,
    callbackUrl: g.callbackUrl ?? null,
    secretConfigured: !!g.secretKey,
    // Bangla QR fields
    qrImageUrl: g.qrImageUrl ?? null,
    merchantName: g.merchantName ?? null,
    paymentInstructions: g.paymentInstructions ?? null,
    successMessage: g.successMessage ?? null,
    failureMessage: g.failureMessage ?? null,
    updatedAt: g.updatedAt.toISOString(),
  };
}

// Public: status map (enabled/disabled per gateway). Used by checkout UIs.
router.get("/payment-gateways/status", async (req, res): Promise<void> => {
  await seedGateways();
  const rows = await db.select().from(paymentGatewaysTable);
  const status: Record<string, boolean> = {};
  for (const row of rows) status[row.gateway] = row.enabled;
  res.json(status);
});

// Public: Bangla QR config needed by the checkout screen (no secrets exposed).
router.get("/payment-gateways/bangla-qr/config", async (req, res): Promise<void> => {
  await seedGateways();
  const [row] = await db
    .select()
    .from(paymentGatewaysTable)
    .where(eq(paymentGatewaysTable.gateway, "bangla_qr"));
  if (!row || !row.enabled) {
    res.status(404).json({ error: "Bangla QR not enabled" });
    return;
  }
  res.json({
    enabled: row.enabled,
    merchantName: row.merchantName ?? null,
    qrImageUrl: row.qrImageUrl ?? null,
    paymentInstructions: row.paymentInstructions ?? null,
    successMessage: row.successMessage ?? null,
    failureMessage: row.failureMessage ?? null,
  });
});

router.get("/admin/payment-gateways", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }
  await seedGateways();
  const rows = await db.select().from(paymentGatewaysTable);
  res.json(rows.map(serialize));
});

router.put("/admin/payment-gateways/:gateway", async (req, res): Promise<void> => {
  const actor = await getActor(req.headers.authorization);
  if (actor.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  const gateway = req.params.gateway as PaymentGatewayKey;
  if (!PAYMENT_GATEWAYS.includes(gateway)) {
    res.status(400).json({ error: `Invalid gateway. Must be one of: ${PAYMENT_GATEWAYS.join(", ")}` });
    return;
  }

  const b = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (typeof b.enabled === "boolean") updates.enabled = b.enabled;
  if (b.apiKey !== undefined) updates.apiKey = b.apiKey || null;
  // Only overwrite the secret when a non-empty value is provided.
  if (b.secretKey) updates.secretKey = b.secretKey;
  if (b.merchantId !== undefined) updates.merchantId = b.merchantId || null;
  if (b.mode === "sandbox" || b.mode === "live") updates.mode = b.mode;
  if (b.successUrl !== undefined) updates.successUrl = b.successUrl || null;
  if (b.failedUrl !== undefined) updates.failedUrl = b.failedUrl || null;
  if (b.callbackUrl !== undefined) updates.callbackUrl = b.callbackUrl || null;
  // Bangla QR-specific fields
  if (b.qrImageUrl !== undefined) updates.qrImageUrl = b.qrImageUrl || null;
  if (b.merchantName !== undefined) updates.merchantName = b.merchantName || null;
  if (b.paymentInstructions !== undefined) updates.paymentInstructions = b.paymentInstructions || null;
  if (b.successMessage !== undefined) updates.successMessage = b.successMessage || null;
  if (b.failureMessage !== undefined) updates.failureMessage = b.failureMessage || null;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }

  await seedGateways();
  const [existing] = await db.select().from(paymentGatewaysTable).where(eq(paymentGatewaysTable.gateway, gateway));
  if (!existing) { res.status(404).json({ error: "Gateway not found" }); return; }

  const [updated] = await db.update(paymentGatewaysTable).set(updates)
    .where(eq(paymentGatewaysTable.gateway, gateway)).returning();

  await writeAudit(actor, "update", "payment_gateway", updated.id);
  res.json(serialize(updated));
});

export default router;
