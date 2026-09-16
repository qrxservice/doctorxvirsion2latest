import { shurjopayInitiate, shurjopayVerify } from "../../lib/shurjopay";
import type { PaymentProvider, CreatePaymentParams, CreatePaymentResult, VerifyPaymentResult, RefundPaymentResult } from "./paymentProvider";

export interface ShurjopayConfig {
  mode: string;       // "sandbox" | "live"
  username: string;   // stored in payment_gateways.api_key
  password: string;   // stored in payment_gateways.secret_key
}

export class ShurjopayProvider implements PaymentProvider {
  readonly gateway = "shurjopay";
  private config: ShurjopayConfig;

  constructor(config: ShurjopayConfig) {
    this.config = config;
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult> {
    const result = await shurjopayInitiate({
      mode: this.config.mode,
      username: this.config.username,
      password: this.config.password,
      amount: params.amount,
      orderId: params.tranId,
      currency: params.currency || "BDT",
      returnUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      customerPhone: params.customerPhone,
      clientIp: params.clientIp,
      productName: params.productName,
    });
    return {
      ok: result.ok,
      checkoutUrl: result.checkoutUrl,
      gatewayRef: result.spOrderId,
      raw: result.raw,
    };
  }

  async verifyPayment(gatewayRef: string): Promise<VerifyPaymentResult> {
    const result = await shurjopayVerify(
      this.config.mode,
      this.config.username,
      this.config.password,
      gatewayRef
    );
    return { ok: result.ok, raw: result.raw };
  }

  /** ShurjoPay refund is handled via merchant dashboard or API — stub for future use. */
  async refundPayment(_gatewayRef: string, _amount?: number): Promise<RefundPaymentResult> {
    return { ok: false, message: "Refunds for ShurjoPay must be initiated from the merchant dashboard.", raw: null };
  }
}
