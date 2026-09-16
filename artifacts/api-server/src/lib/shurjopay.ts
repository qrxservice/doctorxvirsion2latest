import { randomBytes } from "crypto";

// Minimal ShurjoPay REST client. No SDK dependency.
// Docs: https://shurjopayment.com/

export function shurjopayBase(mode: string): string {
  return mode === "live"
    ? "https://engine.shurjopayment.com"
    : "https://sandbox.shurjopayment.com";
}

export function generateTranId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

export interface ShurjopayToken {
  token: string;
  storeId: string;
  executeUrl: string;
  tokenType: string;
  expiresIn: number;
}

/** Step 1: obtain a short-lived auth token from ShurjoPay. */
export async function shurjopayGetToken(
  mode: string,
  username: string,
  password: string
): Promise<ShurjopayToken | null> {
  try {
    const res = await fetch(`${shurjopayBase(mode)}/api/get_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!data || data.token_type === undefined) return null;
    return {
      token: String(data.token ?? ""),
      storeId: String(data.store_id ?? ""),
      executeUrl: String(data.execute_url ?? `${shurjopayBase(mode)}/api/secret-pay`),
      tokenType: String(data.token_type ?? "Bearer"),
      expiresIn: Number(data.expires_in ?? 3600),
    };
  } catch {
    return null;
  }
}

export interface ShurjopayInitiateParams {
  mode: string;
  username: string;
  password: string;
  amount: number;
  orderId: string;            // our internal tran_id / order reference
  currency: string;           // "BDT" (ShurjoPay primary) or "USD"
  returnUrl: string;
  cancelUrl: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerAddress?: string;
  customerCity?: string;
  clientIp?: string;
  productName?: string;
}

export interface ShurjopayInitiateResult {
  ok: boolean;
  checkoutUrl?: string;
  spOrderId?: string;         // ShurjoPay's own order id, needed for verification
  raw: unknown;
}

/** Step 2: create a payment session and get the hosted checkout URL. */
export async function shurjopayInitiate(p: ShurjopayInitiateParams): Promise<ShurjopayInitiateResult> {
  const auth = await shurjopayGetToken(p.mode, p.username, p.password);
  if (!auth?.token) return { ok: false, raw: { error: "Token acquisition failed" } };

  try {
    const body = {
      prefix: "DoctorX",
      token: auth.token,
      store_id: auth.storeId,
      return_url: p.returnUrl,
      cancel_url: p.cancelUrl,
      amount: p.amount,
      currency: p.currency || "BDT",
      order_id: p.orderId,
      customer_name: p.customerName,
      customer_email: p.customerEmail,
      customer_phone: p.customerPhone || "01700000000",
      customer_address: p.customerAddress || "N/A",
      customer_city: p.customerCity || "Dhaka",
      customer_country: "Bangladesh",
      client_ip: p.clientIp || "127.0.0.1",
      product_name: p.productName || "DoctorX Service",
      product_profile: "general",
    };

    const res = await fetch(auth.executeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null) as Record<string, unknown> | null;

    if (data?.checkout_url && typeof data.checkout_url === "string") {
      return {
        ok: true,
        checkoutUrl: data.checkout_url,
        spOrderId: String(data.sp_order_id ?? p.orderId),
        raw: data,
      };
    }
    return { ok: false, raw: data };
  } catch (err) {
    return { ok: false, raw: { error: String(err) } };
  }
}

export interface ShurjopayVerifyResult {
  ok: boolean;
  spOrderId?: string;
  bankTranId?: string;
  raw: unknown;
}

/** Step 3: server-side verification of a completed payment. */
export async function shurjopayVerify(
  mode: string,
  username: string,
  password: string,
  spOrderId: string
): Promise<ShurjopayVerifyResult> {
  const auth = await shurjopayGetToken(mode, username, password);
  if (!auth?.token) return { ok: false, raw: { error: "Token acquisition failed" } };

  try {
    const res = await fetch(`${shurjopayBase(mode)}/api/verification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `${auth.tokenType} ${auth.token}`,
      },
      body: JSON.stringify({ order_id: spOrderId }),
    });
    const data = await res.json().catch(() => null);
    // Response is an array; first element contains the status
    const record = Array.isArray(data) ? (data[0] as Record<string, unknown>) : (data as Record<string, unknown> | null);
    const status = String(record?.bank_status ?? record?.sp_code ?? "");
    // "1000" or "Success" indicates approved payment
    const ok = status === "1000" || status.toLowerCase() === "success";
    return {
      ok,
      spOrderId: String(record?.order_id ?? spOrderId),
      bankTranId: record?.bank_tran_id ? String(record.bank_tran_id) : undefined,
      raw: data,
    };
  } catch (err) {
    return { ok: false, raw: { error: String(err) } };
  }
}
