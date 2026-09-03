import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { requirePortalActor } from "@/lib/auth/rbac";
import { verifyCheckoutSignature } from "@/lib/services/payment.service";
import { checkoutResultSchema } from "@/lib/validation/finance";
import { log } from "@/lib/logger";

/**
 * What the browser reports after Razorpay's checkout closes.
 *
 * The signature is verified so the page can tell the client something true —
 * but **this does not credit anything**. The invoice is marked paid when the
 * webhook arrives, because a browser callback can be forged and a genuine one
 * can be lost when someone closes the tab (CLAUDE.md 11).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const verifyLog = log("payments");

export async function POST(request: Request): Promise<NextResponse> {
  const actor = await currentActor();

  try {
    requirePortalActor(actor);
  } catch {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }

  const parsed = checkoutResultSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ verified: false, error: "Incomplete result." }, { status: 400 });
  }

  const verified = verifyCheckoutSignature({
    orderId: parsed.data.razorpay_order_id,
    paymentId: parsed.data.razorpay_payment_id,
    signature: parsed.data.razorpay_signature,
  });

  verifyLog.info(
    { orderId: parsed.data.razorpay_order_id, verified },
    "checkout callback verified",
  );

  return NextResponse.json({
    verified,
    // Said plainly, so the page does not imply the books are updated.
    message: verified
      ? "Payment received. Your invoice updates once the gateway confirms it, usually within a minute."
      : "We could not verify that payment. If money left your account, tell us and we will check.",
  });
}
