import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db, paymentGatewaysTable, paymentTransactionsTable,
  subscriptionsTable, doctorsTable, usersTable, appSettingsTable,
  shopOrdersTable,
} from "@workspace/db";
import { verifyAuthToken } from "../lib/token";
import { sslcommerzInitiate, sslcommerzValidate, generateTranId } from "../lib/sslcommerz";
import { notify } from "../lib/notify";

const router: IRouter = Router();

const APP_URL = process.env.APP_URL || "https://doctorx.com.bd";

async function getMonthlyFee(): Promise<number> {
  try {
    const [settings] = await db.select().from(appSettingsTable).limit(1);
    return settings?.monthlySubscriptionFee ?? 500;
  } catch { return 500; }
}

function addMonths(dateStr: string | null | undefined, months: number): string {
  const base = dateStr && dateStr >= new Date().toISOString().split("T")[0]
    ? new Date(dateStr)
    : new Date();
  base.setMonth(base.getMonth() + months);
  return base.toISOString().split("T")[0];
}

/** POST /doctors/me/subscription/pay/sslcommerz — doctor-initiated online payment.
 *  Creates a payment_transactions row and returns the SSLCommerz gateway URL to redirect to. */
router.post("/doctors/me/subscription/pay/sslcommerz", async (req, res): Promise<void> => {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user?.doctorId) { res.status(404).json({ error: "Doctor not found" }); return; }

  const rawMonths = Number(req.body?.months);
  const months = Number.isInteger(rawMonths) && rawMonths >= 1 && rawMonths <= 120 ? rawMonths : 1;

  const [gateway] = await db.select().from(paymentGatewaysTable).where(eq(paymentGatewaysTable.gateway, "sslcommerz"));
  if (!gateway || !gateway.enabled) { res.status(400).json({ error: "SSLCommerz is not enabled" }); return; }
  if (!gateway.apiKey || !gateway.secretKey) { res.status(400).json({ error: "SSLCommerz is not configured" }); return; }

  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, user.doctorId));
  if (!doctor) { res.status(404).json({ error: "Doctor not found" }); return; }

  // SSLCommerz is a Bangladesh-only payment gateway and cannot process USD.
  // USD-billed doctors must use the manual payment fallback instead.
  if (doctor.currency === "USD") {
    res.status(400).json({ error: "Online payment via SSLCommerz is only available for BDT accounts. Please contact the admin to arrange payment." });
    return;
  }

  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.doctorId, user.doctorId));
  if (!sub) { res.status(404).json({ error: "Subscription not found" }); return; }

  const monthlyFee = await getMonthlyFee();
  const amount = monthlyFee * months;
  if (amount <= 0) { res.status(400).json({ error: "Nothing to pay" }); return; }

  const tranId = generateTranId("sub");
  const base = `${req.protocol}://${req.get("host")}/api`;

  const result = await sslcommerzInitiate({
    storeId: gateway.apiKey,
    storePasswd: gateway.secretKey,
    mode: gateway.mode,
    amount,
    tranId,
    successUrl: `${base}/payments/sslcommerz/success`,
    failUrl: `${base}/payments/sslcommerz/fail`,
    cancelUrl: `${base}/payments/sslcommerz/cancel`,
    ipnUrl: `${base}/payments/sslcommerz/ipn`,
    customerName: doctor.name,
    customerEmail: doctor.email,
    customerPhone: doctor.phone ?? "",
    productName: `DoctorX Doctor Subscription (${months} month${months > 1 ? "s" : ""})`,
  });

  await db.insert(paymentTransactionsTable).values({
    gateway: "sslcommerz",
    tranId,
    purpose: "doctor_subscription",
    subscriptionId: sub.id,
    doctorId: doctor.id,
    months,
    amount,
    currency: "BDT",
    status: "initiated",
    gatewayResponse: JSON.stringify(result.raw ?? null),
  });

  if (!result.ok || !result.gatewayUrl) {
    res.status(502).json({ error: "Failed to initiate SSLCommerz session" });
    return;
  }

  res.json({ url: result.gatewayUrl, tranId });
});

/** POST /shop/orders/:id/pay/sslcommerz — patient-initiated online payment for a shop order.
 *  Creates a payment_transactions row and returns the SSLCommerz gateway URL to redirect to. */
router.post("/shop/orders/:id/pay/sslcommerz", async (req, res): Promise<void> => {
  const claims = verifyAuthToken(req.headers.authorization);
  if (!claims) { res.status(401).json({ error: "Not authenticated" }); return; }

  const orderId = parseInt(req.params.id);
  if (!Number.isInteger(orderId)) { res.status(400).json({ error: "Invalid order id" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, claims.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [order] = await db.select().from(shopOrdersTable).where(eq(shopOrdersTable.id, orderId));
  if (!order || order.userId !== user.id) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.paymentStatus === "paid") { res.status(400).json({ error: "Order is already paid" }); return; }

  const [gateway] = await db.select().from(paymentGatewaysTable).where(eq(paymentGatewaysTable.gateway, "sslcommerz"));
  if (!gateway || !gateway.enabled) { res.status(400).json({ error: "SSLCommerz is not enabled" }); return; }
  if (!gateway.apiKey || !gateway.secretKey) { res.status(400).json({ error: "SSLCommerz is not configured" }); return; }

  const amount = Math.round(parseFloat(order.totalAmount));
  if (!(amount > 0)) { res.status(400).json({ error: "Nothing to pay" }); return; }

  const tranId = generateTranId("order");
  const base = `${req.protocol}://${req.get("host")}/api`;

  const result = await sslcommerzInitiate({
    storeId: gateway.apiKey,
    storePasswd: gateway.secretKey,
    mode: gateway.mode,
    amount,
    tranId,
    successUrl: `${base}/payments/sslcommerz/success`,
    failUrl: `${base}/payments/sslcommerz/fail`,
    cancelUrl: `${base}/payments/sslcommerz/cancel`,
    ipnUrl: `${base}/payments/sslcommerz/ipn`,
    customerName: order.shippingName || user.name || "Customer",
    customerEmail: user.email,
    customerPhone: order.shippingPhone ?? "",
    productName: `DoctorX Shop Order #${order.id}`,
  });

  await db.insert(paymentTransactionsTable).values({
    gateway: "sslcommerz",
    tranId,
    purpose: "shop_order",
    orderId: order.id,
    amount,
    currency: "BDT",
    status: "initiated",
    gatewayResponse: JSON.stringify(result.raw ?? null),
  });

  if (!result.ok || !result.gatewayUrl) {
    res.status(502).json({ error: "Failed to initiate SSLCommerz session" });
    return;
  }

  res.json({ url: result.gatewayUrl, tranId });
});

async function finalizeTransaction(tranId: string, incomingStatus: "success" | "failed" | "cancelled", valId?: string) {
  const [txn] = await db.select().from(paymentTransactionsTable).where(eq(paymentTransactionsTable.tranId, tranId));
  if (!txn) return { ok: false as const };
  if (txn.status === "success") return { ok: true as const, txn }; // already processed, idempotent

  let finalStatus: "success" | "failed" | "cancelled" = incomingStatus;

  if (incomingStatus === "success" && valId) {
    const [gateway] = await db.select().from(paymentGatewaysTable).where(eq(paymentGatewaysTable.gateway, txn.gateway));
    if (gateway?.apiKey && gateway?.secretKey) {
      const validation = await sslcommerzValidate(gateway.mode, gateway.apiKey, gateway.secretKey, valId);
      finalStatus = validation.ok ? "success" : "failed";
    } else {
      finalStatus = "failed";
    }
  }

  const [updated] = await db.update(paymentTransactionsTable).set({
    status: finalStatus,
    gatewayValId: valId ?? null,
  }).where(eq(paymentTransactionsTable.id, txn.id)).returning();

  if (finalStatus === "success" && txn.purpose === "doctor_subscription" && txn.subscriptionId && txn.months) {
    const [existing] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, txn.subscriptionId));
    if (existing) {
      const today = new Date().toISOString().split("T")[0];
      const endDate = addMonths(existing.endDate, txn.months);
      await db.update(subscriptionsTable).set({
        months: txn.months,
        monthlyFee: Math.round(txn.amount / txn.months),
        fee: txn.amount,
        paymentStatus: "paid",
        status: "active",
        startDate: existing.startDate ?? today,
        endDate,
      }).where(eq(subscriptionsTable.id, txn.subscriptionId));
      // Notify the doctor about successful subscription payment
      const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, existing.doctorId));
      if (doc) {
        const [docUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.doctorId, doc.id));
        if (docUser) {
          notify(docUser.id, "subscription_paid", "Subscription Payment Confirmed",
            `Your ${txn.months}-month subscription (৳${txn.amount}) has been paid. Your account is active until ${endDate ?? "N/A"}.`
          ).catch(() => {});
        }
      }
    }
  }

  if (txn.purpose === "shop_order" && txn.orderId) {
    const [shopOrder] = await db.select({ userId: shopOrdersTable.userId })
      .from(shopOrdersTable).where(eq(shopOrdersTable.id, txn.orderId));
    await db.update(shopOrdersTable).set({
      paymentStatus: finalStatus === "success" ? "paid" : "unpaid",
      paymentMethod: "sslcommerz",
      ...(finalStatus === "success" ? { status: "processing" } : {}),
    }).where(eq(shopOrdersTable.id, txn.orderId));
    // Notify the customer about order payment
    if (finalStatus === "success" && shopOrder?.userId) {
      notify(shopOrder.userId, "order_paid", "Order Payment Confirmed",
        `Your shop order #${txn.orderId} payment of ৳${txn.amount} was successful. We're processing your order.`, txn.orderId
      ).catch(() => {});
    }
  }

  return { ok: true as const, txn: updated };
}

function redirectToApp(res: import("express").Response, status: string, tranId: string, purpose?: string) {
  const purposeParam = purpose ? `&purpose=${encodeURIComponent(purpose)}` : "";
  res.redirect(302, `${APP_URL}/payment-result?status=${status}&tranId=${encodeURIComponent(tranId)}${purposeParam}`);
}

// SSLCommerz POSTs form-encoded data to these endpoints (no auth header available).
router.post("/payments/sslcommerz/success", async (req, res): Promise<void> => {
  const tranId = String(req.body?.tran_id ?? "");
  const valId = req.body?.val_id ? String(req.body.val_id) : undefined;
  if (!tranId) { res.status(400).send("Missing tran_id"); return; }
  const result = await finalizeTransaction(tranId, "success", valId);
  redirectToApp(res, result.ok && result.txn?.status === "success" ? "success" : "failed", tranId, result.txn?.purpose);
});

router.post("/payments/sslcommerz/fail", async (req, res): Promise<void> => {
  const tranId = String(req.body?.tran_id ?? "");
  const result = tranId ? await finalizeTransaction(tranId, "failed") : undefined;
  redirectToApp(res, "failed", tranId, result?.ok ? result.txn?.purpose : undefined);
});

router.post("/payments/sslcommerz/cancel", async (req, res): Promise<void> => {
  const tranId = String(req.body?.tran_id ?? "");
  const result = tranId ? await finalizeTransaction(tranId, "cancelled") : undefined;
  redirectToApp(res, "cancelled", tranId, result?.ok ? result.txn?.purpose : undefined);
});

// Server-to-server IPN — SSLCommerz calls this independently of the browser redirect.
router.post("/payments/sslcommerz/ipn", async (req, res): Promise<void> => {
  const tranId = String(req.body?.tran_id ?? "");
  const valId = req.body?.val_id ? String(req.body.val_id) : undefined;
  const status = String(req.body?.status ?? "");
  if (!tranId) { res.status(400).json({ error: "Missing tran_id" }); return; }
  if (status === "VALID" || status === "VALIDATED") {
    await finalizeTransaction(tranId, "success", valId);
  } else {
    await finalizeTransaction(tranId, "failed");
  }
  res.status(200).json({ received: true });
});

export default router;
