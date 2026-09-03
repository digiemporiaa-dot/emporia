import { NextResponse } from "next/server";
import { payments } from "@/lib/payments";
import { handleWebhook } from "@/lib/services/payment.service";
import { log } from "@/lib/logger";

/**
 * Razorpay webhook.
 *
 * This is the only thing that marks an invoice paid. A browser reporting
 * success is not enough — anyone can post that — so the money is credited when
 * the gateway tells us, over a request whose signature we verify against the
 * **raw** body (CLAUDE.md 11).
 *
 * Replays are expected: Razorpay retries until it gets a 2xx. Every reply here
 * is a 200 once the signature checks out, and the service is idempotent on the
 * gateway's own payment id, so a retry credits nothing twice.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const hookLog = log("razorpay");

export async function POST(request: Request): Promise<NextResponse> {
  // The raw text, not a parsed body: the signature covers the exact bytes, and
  // re-serialising JSON would change them.
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") ?? "";

  const provider = payments();

  if (!provider.configured) {
    hookLog.warn("webhook arrived with no gateway configured");
    return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
  }

  if (!signature || !provider.verifyWebhook(rawBody, signature)) {
    // Deliberately terse: an attacker learns nothing about why it failed.
    hookLog.warn({ hasSignature: Boolean(signature) }, "webhook signature rejected");
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  let event;
  try {
    event = provider.parseWebhook(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed body." }, { status: 400 });
  }

  try {
    const result = await handleWebhook(event);

    // 200 either way once the signature is good: an ignored or duplicate event
    // is handled, and telling the gateway otherwise just invites more retries.
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    hookLog.error({ err: error, event: event.event }, "webhook processing failed");
    // A 500 asks Razorpay to retry, which is what we want if our own write
    // failed for a transient reason.
    return NextResponse.json({ error: "Could not process that event." }, { status: 500 });
  }
}
