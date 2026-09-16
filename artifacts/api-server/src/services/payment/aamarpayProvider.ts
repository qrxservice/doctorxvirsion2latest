import { aamarpayInitiate, aamarpayVerify } from "../../lib/aamarpay";
import type { PaymentProvider, CreatePaymentParams, CreatePaymentResult, VerifyPaymentResult, RefundPaymentResult } from "./paymentProvider";

export interface AamarpayConfig {
  mode: string;         // "sandbox" | "live"
  storeId: string;      // stored in payment_gateways.api_key
  signatureKey: string; // stored in payment_gateways.secret_key
}

export class AamarpayProvider implements PaymentProvider {
  readonly gateway = "aamarpay";
  private config: AamarpayConfig;

  constructor(config: AamarpayConfig) {
    this.config = config;
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const result = await aamarpayInitiate({
      mode: this.config.mode,
      storeId: this.config.storeId,
      signatureKey: this.config.signatureKey,
      amount: params.amount,
      tranId: params.tranId,
      currency: params.currency || "BDT",
      successUrl: params.successUrl,
      failUrl: params.failUrl,
      cancelUrl: params.cancelUrl,
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      customerPhone: params.customerPhone,
      productName: params.productName,
    });
    return {
      ok: result.ok,
      checkoutUrl: result.checkoutUrl,
      gatewayRef: undefined, // aamarPay uses tran_id for verification
      raw: result.raw,
    };
  }

  async verifyPayment(tranId: string): Promise<VerifyPaymentResult> {
    const result = await aamarpayVerify(
      this.config.mode,
      this.config.storeId,
      this.config.signatureKey,
      tranId
    );
    return { ok: result.ok, raw: result.raw };
  }

  /** aamarPay refund is handled via merchant dashboard — stub for future use. */
  async refundPayment(_tranId: string, _amount?: number): Promise<RefundPaymentResult> {
    return { ok: false, message: "Refunds for aamarPay must be initiated from the merchant dashboard.", raw: null };
  }
}
