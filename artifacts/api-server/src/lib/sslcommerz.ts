import { randomBytes } from "crypto";

// Minimal SSLCommerz REST client. No SDK dependency — SSLCommerz's API is
// plain form-encoded POST/GET, so we call it directly with fetch.
// Sandbox base is fixed; live base is used only when a gateway's mode is "live".

export function sslcommerzBase(mode: string): string {
  return mode === "live" ? "https://securepay.sslcommerz.com" : "https://sandbox.sslcommerz.com";
}

export function generateTranId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

export interface SslInitiateParams {
  storeId: string;
  storePasswd: string;
  mode: string;
  amount: number;
  tranId: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  ipnUrl: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  productName: string;
}

export interface SslInitiateResult {
  ok: boolean;
  gatewayUrl?: string;
  raw: unknown;
}

export async function sslcommerzInitiate(p: SslInitiateParams): Promise<SslInitiateResult> {
  const body = new URLSearchParams({
    store_id: p.storeId,
    store_passwd: p.storePasswd,
    total_amount: String(p.amount),
    currency: "BDT",
    tran_id: p.tranId,
    success_url: p.successUrl,
    fail_url: p.failUrl,
    cancel_url: p.cancelUrl,
    ipn_url: p.ipnUrl,
    cus_name: p.customerName,
    cus_email: p.customerEmail,
    cus_add1: "N/A",
    cus_city: "Dhaka",
    cus_country: "Bangladesh",
    cus_phone: p.customerPhone || "01700000000",
    shipping_method: "NO",
    product_name: p.productName,
    product_category: "Service",
    product_profile: "general",
  });

  const res = await fetch(`${sslcommerzBase(p.mode)}/gwprocess/v4/api.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (data && data.status === "SUCCESS" && typeof data.GatewayPageURL === "string") {
    return { ok: true, gatewayUrl: data.GatewayPageURL, raw: data };
  }
  return { ok: false, raw: data };
}

export interface SslValidateResult {
  ok: boolean;
  raw: unknown;
}

export async function sslcommerzValidate(mode: string, storeId: string, storePasswd: string, valId: string): Promise<SslValidateResult> {
  const params = new URLSearchParams({
    val_id: valId,
    store_id: storeId,
    store_passwd: storePasswd,
    format: "json",
  });
  const res = await fetch(`${sslcommerzBase(mode)}/validator/api/validationserverAPI.php?${params.toString()}`);
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  const status = data?.status;
  const ok = status === "VALID" || status === "VALIDATED";
  return { ok, raw: data };
}
