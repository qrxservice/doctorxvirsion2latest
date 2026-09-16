import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db, paymentGatewaysTable, paymentTransactionsTable,
  subscriptionsTable, doctorsTable, usersTable, appSettingsTable,
  shopOrdersTable,
} from "@workspace/db";
import { verifyAuthToken } from "../lib/token";
import { generateTranId } from "../lib/shurjopay";
import { ShurjopayProvider } from "../services/payment/shurjopayProvider";
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

/** Build a gateway-bound ShurjoPay verifier using the sp_order_id stored at checkout time. */
function makeVerifier(gateway: typeof paymentGatewaysTable.$inferSelect, spOrderId: string | null) {
  if (!gateway.apiKey || !gateway.secretKey || !spOrderId) return undefined;
  return async () => {
    const provider = new ShurjopayProvider({
      mode: gateway.mode,
      username: gateway.apiKey!,
      password: gateway.secretKey!,
    });
    const v = await provider.verifyPayment(spOrderId);
    return v.ok;
  };
}

/** POST /doctors/me/subscription/pay/shurjopay — doctor-initiated subscription payment. */
router.post("/doctors/me/subscription/pay/shurjopay", async (req, res): Promise<void> => {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user?.doctorId) { res.status(404).json({ error: "Doctor not found" }); return; }

  const rawMonths = Number(req.body?.months);
  const months = Number.isInteger(rawMonths) && rawMonths >= 1 && rawMonths <= 120 ? rawMonths : 1;

  const [gateway] = await db.select().from(paymentGatewaysTable).where(eq(paymentGatewaysTable.gateway, "shurjopay"));
  if (!gateway || !gateway.enabled) { res.status(400).json({ error: "ShurjoPay is not enabled" }); return; }
  if (!gateway.apiKey || !gateway.secretKey) { res.status(400).json({ error: "ShurjoPay is not configured" }); return; }

  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, user.doctorId));
  if (!doctor) { res.status(404).json({ error: "Doctor not found" }); return; }

  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.doctorId, user.doctorId));
  if (!sub) { res.status(404).json({ error: "Subscription not found" }); return; }

  const currency = (doctor.currency as "BDT" | "USD") || "BDT";
  const monthlyFee = await getSettingsAndFee(currency);
  const amount = monthlyFee * months;
  if (amount <= 0) { res.status(400).json({ error: "Nothing to pay" }); return; }

  const tranId = generateTranId("sp_sub");
  const base = `${req.protocol}://${req.get("host")}/api`;
  const provider = new ShurjopayProvider({ mode: gateway.mode, username: gateway.apiKey, password: gateway.secretKey });

  // Insert before gateway call so the row exists for any early callback.
  await db.insert(paymentTransactionsTable).values({
    gateway: "shurjopay", tranId, purpose: "doctor_subscription",
    subscriptionId: sub.id, doctorId: doctor.id, months, amount, currency, status: "initiated",
  });

  const result = await provider.createPayment({
    tranId, amount, currency,
    successUrl: `${base}/payments/shurjopay/success`,
    failUrl: `${base}/payments/shurjopay/fail`,
    cancelUrl: `${base}/payments/shurjopay/cancel`,
    customerName: doctor.name, customerEmail: doctor.email,
    customerPhone: doctor.phone ?? "",
    productName: `DoctorX Doctor Subscription (${months} month${months > 1 ? "s" : ""})`,
    clientIp: req.socket?.remoteAddress,
  });

  // Persist sp_order_id immediately so the callback always has the canonical verification ref.
  await db.update(paymentTransactionsTable).set({
    gatewayResponse: JSON.stringify(result.raw ?? null),
    gatewayValId: result.gatewayRef ?? null,
  }).where(eq(paymentTransactionsTable.tranId, tranId));

  if (!result.ok || !result.checkoutUrl) {
    res.status(502).json({ error: "Failed to initiate ShurjoPay session" });
    return;
  }

  res.json({ url: result.checkoutUrl, tranId, gatewayRef: result.gatewayRef });
});

/** POST /shop/orders/:id/pay/shurjopay — patient-initiated shop order payment. */
router.post("/shop/orders/:id/pay/shurjopay", async (req, res): Promise<void> => {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Not authenticated" }); return; }

  const orderId = parseInt(req.params.id);
  if (!Number.isInteger(orderId)) { res.status(400).json({ error: "Invalid order id" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [order] = await db.select().from(shopOrdersTable).where(eq(shopOrdersTable.id, orderId));
  if (!order || order.userId !== user.id) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.paymentStatus === "paid") { res.status(400).json({ error: "Order is already paid" }); return; }

  const [gateway] = await db.select().from(paymentGatewaysTable).where(eq(paymentGatewaysTable.gateway, "shurjopay"));
  if (!gateway || !gateway.enabled) { res.status(400).json({ error: "ShurjoPay is not enabled" }); return; }
  if (!gateway.apiKey || !gateway.secretKey) { res.status(400).json({ error: "ShurjoPay is not configured" }); return; }

  const amount = Math.round(parseFloat(order.totalAmount));
  if (!(amount > 0)) { res.status(400).json({ error: "Nothing to pay" }); return; }

  const tranId = generateTranId("sp_order");
  const base = `${req.protocol}://${req.get("host")}/api`;
  const provider = new ShurjopayProvider({ mode: gateway.mode, username: gateway.apiKey, password: gateway.secretKey });

  await db.insert(paymentTransactionsTable).values({
    gateway: "shurjopay", tranId, purpose: "shop_order",
    orderId: order.id, amount, currency: "BDT", status: "initiated",
  });

  const result = await provider.createPayment({
    tranId, amount, currency: "BDT",
    successUrl: `${base}/payments/shurjopay/success`,
    failUrl: `${base}/payments/shurjopay/fail`,
    cancelUrl: `${base}/payments/shurjopay/cancel`,
    customerName: order.shippingName || user.name || "Customer",
    customerEmail: user.email,
    customerPhone: order.shippingPhone ?? "",
    productName: `DoctorX Shop Order #${order.id}`,
    clientIp: req.socket?.remoteAddress,
  });

  await db.update(paymentTransactionsTable).set({
    gatewayResponse: JSON.stringify(result.raw ?? null),
    gatewayValId: result.gatewayRef ?? null,
  }).where(eq(paymentTransactionsTable.tranId, tranId));

  if (!result.ok || !result.checkoutUrl) {
    res.status(502).json({ error: "Failed to initiate ShurjoPay session" });
    return;
  }

  res.json({ url: result.checkoutUrl, tranId, gatewayRef: result.gatewayRef });
});

// ---------------------------------------------------------------------------
// ShurjoPay callback endpoints.
// ShurjoPay redirects the browser here via GET (or POST in some configs).
// We look up the stored sp_order_id (gatewayValId) and verify server-side.
// ---------------------------------------------------------------------------

async function handleShurjopaySuccess(req: import("express").Request, res: import("express").Response): Promise<void> {
  const tranId = String(req.query?.tran_id ?? req.body?.tran_id ?? "");
  if (!tranId) { res.status(400).send("Missing tran_id"); return; }

  // Load stored transaction — use persisted gatewayValId (sp_order_id), not callback param.
  const [txn] = await db.select().from(paymentTransactionsTable).where(eq(paymentTransactionsTable.tranId, tranId));
  const storedSpOrderId = txn?.gatewayValId ?? null;

  const [gateway] = await db.select().from(paymentGatewaysTable).where(eq(paymentGatewaysTable.gateway, "shurjopay"));

  const result = await finalizeTransaction(tranId, "success", {
    expectedGateway: "shurjopay",
    verifyFn: gateway ? makeVerifier(gateway, storedSpOrderId) : undefined,
  });

  redirectToApp(res, result.ok && result.txn?.status === "success" ? "success" : "failed", tranId, result.txn?.purpose);
}

router.get("/payments/shurjopay/success", handleShurjopaySuccess);
router.post("/payments/shurjopay/success", handleShurjopaySuccess);

async function handleShurjopayFail(req: import("express").Request, res: import("express").Response): Promise<void> {
  const tranId = String(req.query?.tran_id ?? req.body?.tran_id ?? "");
  const result = tranId ? await finalizeTransaction(tranId, "failed", { expectedGateway: "shurjopay" }) : undefined;
  redirectToApp(res, "failed", tranId, result?.ok ? result.txn?.purpose : undefined);
}

router.get("/payments/shurjopay/fail", handleShurjopayFail);
router.post("/payments/shurjopay/fail", handleShurjopayFail);

async function handleShurjopayCancel(req: import("express").Request, res: import("express").Response): Promise<void> {
  const tranId = String(req.query?.tran_id ?? req.body?.tran_id ?? "");
  const result = tranId ? await finalizeTransaction(tranId, "cancelled", { expectedGateway: "shurjopay" }) : undefined;
  redirectToApp(res, "cancelled", tranId, result?.ok ? result.txn?.purpose : undefined);
}

router.get("/payments/shurjopay/cancel", handleShurjopayCancel);
router.post("/payments/shurjopay/cancel", handleShurjopayCancel);

/** GET /payments/shurjopay/verify?tran_id=... — manual/admin verification. */
router.get("/payments/shurjopay/verify", async (req, res): Promise<void> => {
  const tranId = String(req.query?.tran_id ?? "");
  if (!tranId) { res.status(400).json({ error: "Missing tran_id" }); return; }

  const [txn] = await db.select().from(paymentTransactionsTable).where(eq(paymentTransactionsTable.tranId, tranId));
  if (!txn || txn.gateway !== "shurjopay") { res.status(404).json({ error: "Transaction not found" }); return; }

  const [gateway] = await db.select().from(paymentGatewaysTable).where(eq(paymentGatewaysTable.gateway, "shurjopay"));
  if (!gateway?.apiKey || !gateway?.secretKey) { res.status(400).json({ error: "ShurjoPay not configured" }); return; }

  // Always use persisted sp_order_id for verification.
  const spOrderId = txn.gatewayValId;
  if (!spOrderId) { res.status(400).json({ error: "No gateway reference stored for this transaction" }); return; }

  const provider = new ShurjopayProvider({ mode: gateway.mode, username: gateway.apiKey, password: gateway.secretKey });
  const v = await provider.verifyPayment(spOrderId);
  res.json({ tranId, spOrderId, verified: v.ok, raw: v.raw });
});

export default router;
