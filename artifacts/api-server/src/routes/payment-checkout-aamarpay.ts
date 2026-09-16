import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db, paymentGatewaysTable, paymentTransactionsTable,
  subscriptionsTable, doctorsTable, usersTable, appSettingsTable,
  shopOrdersTable,
} from "@workspace/db";
import { verifyAuthToken } from "../lib/token";
import { generateTranId } from "../lib/aamarpay";
import { AamarpayProvider } from "../services/payment/aamarpayProvider";
import { finalizeTransaction } from "../lib/payment-finalize";
import { getMonthlySubscriptionFee } from "../lib/currency";

const router: IRouter = Router();

const APP_URL = process.env.APP_URL || "https://doctorx.com.bd";

function redirectToApp(res: import("express").Response, status: string, tranId: string, purpose?: string) {
  const purposeParam = purpose ? `&purpose=${encodeURIComponent(purpose)}` : "";
  res.redirect(302, `${APP_URL}/payment-result?status=${status}&tranId=${encodeURIComponent(tranId)}${purposeParam}`);
}

async function getSettingsAndFee(currency: string): Promise<number> {
  try {
    const [settings] = await db.select().from(appSettingsTable).limit(1);
    if (!settings) return currency === "USD" ? 5 : 500;
    return getMonthlySubscriptionFee(currency as "BDT" | "USD", settings);
  } catch {
    return currency === "USD" ? 5 : 500;
  }
}

/** POST /doctors/me/subscription/pay/aamarpay — doctor-initiated subscription payment. */
router.post("/doctors/me/subscription/pay/aamarpay", async (req, res): Promise<void> => {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user?.doctorId) { res.status(404).json({ error: "Doctor not found" }); return; }

  const rawMonths = Number(req.body?.months);
  const months = Number.isInteger(rawMonths) && rawMonths >= 1 && rawMonths <= 120 ? rawMonths : 1;

  const [gateway] = await db.select().from(paymentGatewaysTable).where(eq(paymentGatewaysTable.gateway, "aamarpay"));
  if (!gateway || !gateway.enabled) { res.status(400).json({ error: "aamarPay is not enabled" }); return; }
  if (!gateway.apiKey || !gateway.secretKey) { res.status(400).json({ error: "aamarPay is not configured" }); return; }

  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, user.doctorId));
  if (!doctor) { res.status(404).json({ error: "Doctor not found" }); return; }

  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.doctorId, user.doctorId));
  if (!sub) { res.status(404).json({ error: "Subscription not found" }); return; }

  const currency = (doctor.currency as "BDT" | "USD") || "BDT";
  const monthlyFee = await getSettingsAndFee(currency);
  const amount = monthlyFee * months;
  if (amount <= 0) { res.status(400).json({ error: "Nothing to pay" }); return; }

  const tranId = generateTranId("ap_sub");
  const base = `${req.protocol}://${req.get("host")}/api`;
  const provider = new AamarpayProvider({ mode: gateway.mode, storeId: gateway.apiKey, signatureKey: gateway.secretKey });

  await db.insert(paymentTransactionsTable).values({
    gateway: "aamarpay", tranId, purpose: "doctor_subscription",
    subscriptionId: sub.id, doctorId: doctor.id, months, amount, currency, status: "initiated",
  });

  const result = await provider.createPayment({
    tranId, amount, currency,
    successUrl: `${base}/payments/aamarpay/success`,
    failUrl: `${base}/payments/aamarpay/fail`,
    cancelUrl: `${base}/payments/aamarpay/cancel`,
    customerName: doctor.name, customerEmail: doctor.email,
    customerPhone: doctor.phone ?? "",
    productName: `DoctorX Doctor Subscription (${months} month${months > 1 ? "s" : ""})`,
  });

  await db.update(paymentTransactionsTable)
    .set({ gatewayResponse: JSON.stringify(result.raw ?? null) })
    .where(eq(paymentTransactionsTable.tranId, tranId));

  if (!result.ok || !result.checkoutUrl) {
    res.status(502).json({ error: "Failed to initiate aamarPay session" });
    return;
  }

  res.json({ url: result.checkoutUrl, tranId });
});

/** POST /shop/orders/:id/pay/aamarpay — patient-initiated shop order payment. */
router.post("/shop/orders/:id/pay/aamarpay", async (req, res): Promise<void> => {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Not authenticated" }); return; }

  const orderId = parseInt(req.params.id);
  if (!Number.isInteger(orderId)) { res.status(400).json({ error: "Invalid order id" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [order] = await db.select().from(shopOrdersTable).where(eq(shopOrdersTable.id, orderId));
  if (!order || order.userId !== user.id) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.paymentStatus === "paid") { res.status(400).json({ error: "Order is already paid" }); return; }

  const [gateway] = await db.select().from(paymentGatewaysTable).where(eq(paymentGatewaysTable.gateway, "aamarpay"));
  if (!gateway || !gateway.enabled) { res.status(400).json({ error: "aamarPay is not enabled" }); return; }
  if (!gateway.apiKey || !gateway.secretKey) { res.status(400).json({ error: "aamarPay is not configured" }); return; }

  const amount = Math.round(parseFloat(order.totalAmount));
  if (!(amount > 0)) { res.status(400).json({ error: "Nothing to pay" }); return; }

  const tranId = generateTranId("ap_order");
  const base = `${req.protocol}://${req.get("host")}/api`;
  const provider = new AamarpayProvider({ mode: gateway.mode, storeId: gateway.apiKey, signatureKey: gateway.secretKey });

  await db.insert(paymentTransactionsTable).values({
    gateway: "aamarpay", tranId, purpose: "shop_order",
    orderId: order.id, amount, currency: "BDT", status: "initiated",
  });

  const result = await provider.createPayment({
    tranId, amount, currency: "BDT",
    successUrl: `${base}/payments/aamarpay/success`,
    failUrl: `${base}/payments/aamarpay/fail`,
    cancelUrl: `${base}/payments/aamarpay/cancel`,
    customerName: order.shippingName || user.name || "Customer",
    customerEmail: user.email,
    customerPhone: order.shippingPhone ?? "",
    productName: `DoctorX Shop Order #${order.id}`,
  });

  await db.update(paymentTransactionsTable)
    .set({ gatewayResponse: JSON.stringify(result.raw ?? null) })
    .where(eq(paymentTransactionsTable.tranId, tranId));

  if (!result.ok || !result.checkoutUrl) {
    res.status(502).json({ error: "Failed to initiate aamarPay session" });
    return;
  }

  res.json({ url: result.checkoutUrl, tranId });
});

// ---------------------------------------------------------------------------
// aamarPay callback endpoints. aamarPay POSTs form data with tran_id.
// Server-side verification is mandatory — success without valid credentials
// is rejected by finalizeTransaction (never trusts callback alone).
// ---------------------------------------------------------------------------

router.post("/payments/aamarpay/success", async (req, res): Promise<void> => {
  const tranId = String(req.body?.tran_id ?? req.query?.tran_id ?? "");
  if (!tranId) { res.status(400).send("Missing tran_id"); return; }

  const [gateway] = await db.select().from(paymentGatewaysTable).where(eq(paymentGatewaysTable.gateway, "aamarpay"));

  const result = await finalizeTransaction(tranId, "success", {
    expectedGateway: "aamarpay",
    verifyFn: gateway?.apiKey && gateway?.secretKey
      ? async () => {
          const provider = new AamarpayProvider({
            mode: gateway.mode,
            storeId: gateway.apiKey!,
            signatureKey: gateway.secretKey!,
          });
          const v = await provider.verifyPayment(tranId);
          return v.ok;
        }
      : undefined,
  });

  redirectToApp(res, result.ok && result.txn?.status === "success" ? "success" : "failed", tranId, result.txn?.purpose);
});

router.post("/payments/aamarpay/fail", async (req, res): Promise<void> => {
  const tranId = String(req.body?.tran_id ?? req.query?.tran_id ?? "");
  const result = tranId ? await finalizeTransaction(tranId, "failed", { expectedGateway: "aamarpay" }) : undefined;
  redirectToApp(res, "failed", tranId, result?.ok ? result.txn?.purpose : undefined);
});

router.post("/payments/aamarpay/cancel", async (req, res): Promise<void> => {
  const tranId = String(req.body?.tran_id ?? req.query?.tran_id ?? "");
  const result = tranId ? await finalizeTransaction(tranId, "cancelled", { expectedGateway: "aamarpay" }) : undefined;
  redirectToApp(res, "cancelled", tranId, result?.ok ? result.txn?.purpose : undefined);
});

/** GET /payments/aamarpay/verify?tran_id=... — manual/admin verification. */
router.get("/payments/aamarpay/verify", async (req, res): Promise<void> => {
  const tranId = String(req.query?.tran_id ?? "");
  if (!tranId) { res.status(400).json({ error: "Missing tran_id" }); return; }

  const [txn] = await db.select().from(paymentTransactionsTable).where(eq(paymentTransactionsTable.tranId, tranId));
  if (!txn || txn.gateway !== "aamarpay") { res.status(404).json({ error: "Transaction not found" }); return; }

  const [gateway] = await db.select().from(paymentGatewaysTable).where(eq(paymentGatewaysTable.gateway, "aamarpay"));
  if (!gateway?.apiKey || !gateway?.secretKey) { res.status(400).json({ error: "aamarPay not configured" }); return; }

  const provider = new AamarpayProvider({ mode: gateway.mode, storeId: gateway.apiKey, signatureKey: gateway.secretKey });
  const v = await provider.verifyPayment(tranId);
  res.json({ tranId, verified: v.ok, raw: v.raw });
});

export default router;
