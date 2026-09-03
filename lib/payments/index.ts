import "server-only";
import { razorpayConfig } from "@/lib/config/env";
import { RazorpayProvider, UnconfiguredPayments } from "@/lib/payments/razorpay";
import type { PaymentProvider } from "@/lib/payments/types";

export type { CheckoutResult, CreatedOrder, PaymentProvider, WebhookEvent } from "@/lib/payments/types";
export { fromMinorUnits, toMinorUnits } from "@/lib/payments/razorpay";

/**
 * The payment provider for this deployment.
 *
 * Lazy and cached, so `next build` needs no credentials and a deployment
 * without them still boots — it just refuses online payments, while manual
 * payments (bank transfer, cheque, cash) keep working.
 */
let cached: PaymentProvider | null = null;

export function payments(): PaymentProvider {
  if (!cached) {
    const config = razorpayConfig();
    cached = config ? new RazorpayProvider(config) : new UnconfiguredPayments();
  }
  return cached;
}

export function isPaymentsConfigured(): boolean {
  return payments().configured;
}

/** Test seam: drop the memoised provider so a changed environment is re-read. */
export function resetPayments(): void {
  cached = null;
}
