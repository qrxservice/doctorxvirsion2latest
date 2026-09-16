// Payment gateway abstraction layer.
// Each provider implements this interface so checkout routes can call a uniform
// API regardless of which gateway is active.

export interface CreatePaymentParams {
  /** Our internal transaction ID (stored in payment_transactions.tran_id). */
  tranId: string;
  amount: number;
  currency: string;
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  productName?: string;
  clientIp?: string;
}

export interface CreatePaymentResult {
  ok: boolean;
  /** Hosted checkout URL to redirect the customer to. */
  checkoutUrl?: string;
  /** Gateway's own reference ID (e.g. ShurjoPay sp_order_id). Stored as gatewayValId. */
  gatewayRef?: string;
  raw: unknown;
}

export interface VerifyPaymentResult {
  ok: boolean;
  raw: unknown;
}

export interface RefundPaymentResult {
  ok: boolean;
  message?: string;
  raw: unknown;
}

/**
 * Common interface every payment provider must implement.
 *
 * - createPayment  : initiate a hosted checkout session; returns a redirect URL.
 * - verifyPayment  : server-side confirmation of a completed payment.
 * - refundPayment  : initiate a refund for a previously successful transaction.
 */
export interface PaymentProvider {
  readonly gateway: string;
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  verifyPayment(gatewayRef: string): Promise<VerifyPaymentResult>;
  refundPayment(gatewayRef: string, amount?: number): Promise<RefundPaymentResult>;
}
