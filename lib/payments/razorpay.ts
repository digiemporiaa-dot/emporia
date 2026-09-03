import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { razorpayConfig } from "@/lib/config/env";
import { IntegrationNotConfiguredError, ValidationError } from "@/lib/errors";
import { Decimal } from "@/lib/money";
import type {
  CheckoutResult,
  CreatedOrder,
  PaymentProvider,
  RefundResult,
  WebhookEvent,
} from "@/lib/payments/types";

/**
 * Razorpay over its REST API.
 *
 * No SDK: the two calls we make are a POST each, and the signature schemes are
 * plain HMAC-SHA256. Fewer dependencies, and the verification is readable
 * rather than hidden behind a helper.
 *
 * The key secret and webhook secret are read server-side from lib/config/env
 * and never leave this process. Only `publicKey` is ever handed to a browser
 * (CLAUDE.md 2 rule 6).
 */

const API = "https://api.razorpay.com/v1";

/** Rupees to paise, exactly. A JS number would lose the paise on large sums. */
export function toMinorUnits(amount: string): number {
  const minor = new Decimal(amount).times(100);
  if (!minor.isInteger()) {
    throw new ValidationError("That amount is not a whole number of paise.");
  }
  return minor.toNumber();
}

/** Paise back to a fixed 2dp string. */
export function fromMinorUnits(minor: number): string {
  return new Decimal(minor).dividedBy(100).toFixed(2);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // Length-checked first: timingSafeEqual throws on a mismatch.
  return left.length === right.length && timingSafeEqual(left, right);
}

export class RazorpayProvider implements PaymentProvider {
  readonly configured = true;

  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  private readonly endpoint: string;

  constructor(config: NonNullable<ReturnType<typeof razorpayConfig>>) {
    this.keyId = config.keyId;
    this.keySecret = config.keySecret;
    this.webhookSecret = config.webhookSecret;
    // Overridable so the API can be pointed at a local double during
    // verification without changing code.
    this.endpoint = config.endpoint ?? API;
  }

  get publicKey(): string {
    return this.keyId;
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`;
  }

  async createOrder(input: {
    amount: string;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<CreatedOrder> {
    const amountMinor = toMinorUnits(input.amount);

    const response = await fetch(`${this.endpoint}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: this.authHeader() },
      body: JSON.stringify({
        amount: amountMinor,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes ?? {},
        payment_capture: 1,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new ValidationError(
        `The payment gateway refused the order (${response.status}). ${detail.slice(0, 200)}`,
      );
    }

    const order = (await response.json()) as { id: string; amount: number; currency: string };

    return {
      orderId: order.id,
      amountMinor: order.amount,
      currency: order.currency,
      publicKey: this.keyId,
    };
  }

  /** hmac_sha256(order_id + "|" + payment_id, key_secret). */
  verifyCheckout(result: CheckoutResult): boolean {
    const expected = createHmac("sha256", this.keySecret)
      .update(`${result.orderId}|${result.paymentId}`)
      .digest("hex");

    return safeEqual(expected, result.signature);
  }

  /** hmac_sha256(raw request body, webhook_secret). */
  verifyWebhook(rawBody: string, signature: string): boolean {
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    return safeEqual(expected, signature);
  }

  parseWebhook(rawBody: string): WebhookEvent {
    let body: {
      event?: string;
      payload?: { payment?: { entity?: Record<string, unknown> } };
    };

    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      throw new ValidationError("That webhook body is not JSON.");
    }

    const entity = body.payload?.payment?.entity ?? {};

    return {
      event: body.event ?? "unknown",
      paymentId: typeof entity["id"] === "string" ? entity["id"] : null,
      orderId: typeof entity["order_id"] === "string" ? entity["order_id"] : null,
      amountMinor: typeof entity["amount"] === "number" ? entity["amount"] : null,
      currency: typeof entity["currency"] === "string" ? entity["currency"] : null,
      status: typeof entity["status"] === "string" ? entity["status"] : null,
      raw: body,
    };
  }

  async refund(input: {
    paymentId: string;
    amount: string;
    notes?: Record<string, string>;
  }): Promise<RefundResult> {
    const response = await fetch(`${this.endpoint}/payments/${input.paymentId}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: this.authHeader() },
      body: JSON.stringify({ amount: toMinorUnits(input.amount), notes: input.notes ?? {} }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new ValidationError(
        `The payment gateway refused the refund (${response.status}). ${detail.slice(0, 200)}`,
      );
    }

    const refund = (await response.json()) as { id: string; amount: number; status: string };
    return { refundId: refund.id, amountMinor: refund.amount, status: refund.status };
  }
}

/**
 * No gateway configured.
 *
 * Every call throws. Signature verification returns false rather than throwing,
 * because a webhook arriving at an unconfigured deployment should be rejected,
 * not crash the handler (CLAUDE.md 2 rule 5).
 */
export class UnconfiguredPayments implements PaymentProvider {
  readonly configured = false;
  readonly publicKey = "";

  private fail(): never {
    throw new IntegrationNotConfiguredError(
      "Online payments are not configured. Set the RAZORPAY_* environment variables.",
    );
  }

  async createOrder(): Promise<CreatedOrder> {
    this.fail();
  }

  verifyCheckout(): boolean {
    return false;
  }

  verifyWebhook(): boolean {
    return false;
  }

  parseWebhook(): WebhookEvent {
    this.fail();
  }

  async refund(): Promise<RefundResult> {
    this.fail();
  }
}
