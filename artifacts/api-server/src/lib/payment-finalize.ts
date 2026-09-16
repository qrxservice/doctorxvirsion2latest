import { eq } from "drizzle-orm";
import {
  db, paymentTransactionsTable, subscriptionsTable,
  doctorsTable, usersTable, shopOrdersTable,
} from "@workspace/db";
import { notify } from "./notify";

// Shared finalization logic for all payment gateways (ShurjoPay, aamarPay, etc.).
// SSLCommerz uses its own copy inside payment-checkout.ts — this file must NOT
// be imported from there, to preserve the "don't touch SSLCommerz" constraint.

function addMonths(dateStr: string | null | undefined, months: number): string {
  const base =
    dateStr && dateStr >= new Date().toISOString().split("T")[0]
      ? new Date(dateStr)
      : new Date();
  base.setMonth(base.getMonth() + months);
  return base.toISOString().split("T")[0];
}

/**
 * Finalize a payment transaction after a gateway callback.
 *
 * @param tranId - Our internal transaction ID stored in payment_transactions.tranId.
 * @param incomingStatus - The raw outcome reported by the gateway callback.
 * @param options.expectedGateway - If provided, the call is rejected (returns ok:false)
 *   when the stored transaction belongs to a different gateway. This prevents a forged
 *   callback to one gateway's endpoint from affecting another gateway's transaction.
 * @param options.verifyFn - Async function that performs gateway-specific server-side
 *   verification. REQUIRED for success callbacks — if omitted or if it throws, the
 *   transaction is marked failed rather than trusted on the callback's word alone.
 * @param options.valId - Optional gateway verification / validation ID stored on the row.
 */
export async function finalizeTransaction(
  tranId: string,
  incomingStatus: "success" | "failed" | "cancelled",
  options?: {
    expectedGateway?: string;
    verifyFn?: () => Promise<boolean>;
    valId?: string;
  }
): Promise<{ ok: boolean; txn?: typeof paymentTransactionsTable.$inferSelect }> {
  const { expectedGateway, verifyFn, valId } = options ?? {};

  const [txn] = await db
    .select()
    .from(paymentTransactionsTable)
    .where(eq(paymentTransactionsTable.tranId, tranId));
  if (!txn) return { ok: false };

  // Reject if the stored gateway doesn't match what this callback endpoint expects.
  if (expectedGateway && txn.gateway !== expectedGateway) return { ok: false };

  if (txn.status === "success") return { ok: true, txn }; // idempotent

  let finalStatus: "success" | "failed" | "cancelled" = incomingStatus;

  if (incomingStatus === "success") {
    if (verifyFn) {
      // Server-side verification is mandatory; treat any failure or exception as failed.
      const verified = await verifyFn().catch(() => false);
      finalStatus = verified ? "success" : "failed";
    } else {
      // No verifier available — do not trust the callback alone; mark as failed.
      finalStatus = "failed";
    }
  }

  const [updated] = await db
    .update(paymentTransactionsTable)
    .set({ status: finalStatus, gatewayValId: valId ?? null })
    .where(eq(paymentTransactionsTable.id, txn.id))
    .returning();

  // --- Doctor subscription activation ---
  if (finalStatus === "success" && txn.purpose === "doctor_subscription" && txn.subscriptionId && txn.months) {
    const [existing] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, txn.subscriptionId));
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

      const [doc] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, existing.doctorId));
      if (doc) {
        const [docUser] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(eq(usersTable.doctorId, doc.id));
        if (docUser) {
          const symbol = txn.currency === "USD" ? "$" : "৳";
          notify(
            docUser.id,
            "subscription_paid",
            "Subscription Payment Confirmed",
            `Your ${txn.months}-month subscription (${symbol}${txn.amount}) has been paid. Your account is active until ${endDate ?? "N/A"}.`
          ).catch(() => {});
        }
      }
    }
  }

  // --- Shop order activation ---
  if (txn.purpose === "shop_order" && txn.orderId) {
    const [shopOrder] = await db
      .select({ userId: shopOrdersTable.userId })
      .from(shopOrdersTable)
      .where(eq(shopOrdersTable.id, txn.orderId));
    await db.update(shopOrdersTable).set({
      paymentStatus: finalStatus === "success" ? "paid" : "unpaid",
      paymentMethod: txn.gateway,
      ...(finalStatus === "success" ? { status: "processing" } : {}),
    }).where(eq(shopOrdersTable.id, txn.orderId));
    if (finalStatus === "success" && shopOrder?.userId) {
      notify(
        shopOrder.userId,
        "order_paid",
        "Order Payment Confirmed",
        `Your shop order #${txn.orderId} payment of ৳${txn.amount} was successful. We're processing your order.`,
        txn.orderId
      ).catch(() => {});
    }
  }

  return { ok: true, txn: updated };
}
