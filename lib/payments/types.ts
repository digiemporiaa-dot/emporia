/**
 * The payment provider contract.
 *
 * Razorpay is what this deployment uses, but nothing above this file knows
 * that: callers ask for an order, verify a signature, or refund an amount
 * (CLAUDE.md 3).
 *
 * Money crosses this boundary as fixed-precision strings. Providers deal in
 * integer minor units — paise — and that conversion happens in one place, in
 * the implementation, never in a caller (CLAUDE.md 2 rule 1).
 */

export type CreatedOrder = {
  /** The provider's order id, which the browser needs to open checkout. */
  orderId: string;
  /** Minor units, as the provider counts them. */
  amountMinor: number;
  currency: string;
  /** The publishable key the checkout script needs. Never the secret. */
  publicKey: string;
};

export type CheckoutResult = {
  orderId: string;
  paymentId: string;
  signature: string;
};

export type WebhookEvent = {
  /** The provider's event name, e.g. "payment.captured". */
  event: string;
  paymentId: string | null;
  orderId: string | null;
  /** Minor units. */
  amountMinor: number | null;
  currency: string | null;
  status: string | null;
  /** Everything the provider sent, kept for the audit trail. */
  raw: unknown;
};

export type RefundResult = {
  refundId: string;
  amountMinor: number;
  status: string;
};

export interface PaymentProvider {
  readonly configured: boolean;
  /** The publishable key, for the checkout script. */
  readonly publicKey: string;

  createOrder(input: {
    amount: string;
    currency: string;
    /** Our own reference, so a provider order can be traced back. */
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<CreatedOrder>;

  /**
   * Whether a checkout callback really came from the provider.
   *
   * This is the only thing that makes a browser-reported success believable,
   * and even then it is not what marks an invoice paid — the webhook is
   * (CLAUDE.md 11).
   */
  verifyCheckout(result: CheckoutResult): boolean;

  /** Whether a webhook body carries a valid signature for our secret. */
  verifyWebhook(rawBody: string, signature: string): boolean;

  parseWebhook(rawBody: string): WebhookEvent;

  refund(input: { paymentId: string; amount: string; notes?: Record<string, string> }): Promise<RefundResult>;
}
