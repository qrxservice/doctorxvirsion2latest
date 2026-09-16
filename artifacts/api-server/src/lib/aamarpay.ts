import { randomBytes } from "crypto";

// Minimal aamarPay REST client. No SDK dependency.
// Docs: https://aamarpay.com/

export function aamarpayBase(mode: string): string {
  return mode === "live"
    ? "https://secure.aamarpay.com"
    : "https://sandbox.aamarpay.com";
}

export function generateTranId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

export interface AamarpayInitiateParams {
  mode: string;
  storeId: string;        // aamarPay store ID (apiKey field)
  signatureKey: string;   // aamarPay signature key (secretKey field)
  amount: number;
  tranId: string;         // our internal transaction ID
  currency?: string;      // "BDT" default
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress?: string;
  productName?: string;
}

export interface AamarpayInitiateResult {
  ok: boolean;
  checkoutUrl?: string;   // redirect URL returned by aamarPay
  raw: unknown;
}

/** Initiate an aamarPay payment session. Returns a hosted checkout URL. */
export async function aamarpayInitiate(p: AamarpayInitiateParams): Promise<AamarpayInitiateResult> {
  try {
    const body = new URLSearchParams({
      store_id: p.storeId,
      signature_key: p.signatureKey,
      tran_id: p.tranId,
      amount: String(p.amount),
      currency: p.currency || "BDT",
      success_url: p.successUrl,
      fail_url: p.failUrl,
      cancel_url: p.cancelUrl,
      desc: p.productName || "DoctorX Service",
      cus_name: p.customerName,
      cus_email: p.customerEmail,
      cus_phone: p.customerPhone || "01700000000",
      cus_add1: p.customerAddress || "N/A",
      cus_city: "Dhaka",
      cus_country: "Bangladesh",
      type: "json",
    });

    const res = await fetch(`${aamarpayBase(p.mode)}/index.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    // aamarPay responds with JSON containing the redirect URL
    const data = await res.json().catch(() => null) as Record<string, unknown> | null;

    if (data?.payment_url && typeof data.payment_url === "string") {
      return { ok: true, checkoutUrl: data.payment_url, raw: data };
    }
    return { ok: false, raw: data };
  } catch (err) {
    return { ok: false, raw: { error: String(err) } };
  }
}

export interface AamarpayVerifyResult {
  ok: boolean;
  raw: unknown;
}

/** Server-side transaction verification for aamarPay. */
export async function aamarpayVerify(
  mode: string,
  storeId: string,
  signatureKey: string,
  tranId: string
): Promise<AamarpayVerifyResult> {
  try {
    const params = new URLSearchParams({
      request_id: tranId,
      store_id: storeId,
      signature_key: signatureKey,
      type: "json",
    });

    const res = await fetch(
      `${aamarpayBase(mode)}/api/v1/trxcheck/request.php?${params.toString()}`
    );
    const data = await res.json().catch(() => null) as Record<string, unknown> | null;

    // aamarPay returns pay_status: "Successful" on success
    const ok =
      String(data?.pay_status ?? "").toLowerCase() === "successful" ||
      String(data?.status_code ?? "") === "2";
    return { ok, raw: data };
  } catch (err) {
    return { ok: false, raw: { error: String(err) } };
  }
}
