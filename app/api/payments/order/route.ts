import { NextResponse } from "next/server";
import { z } from "zod";
import { currentActor } from "@/lib/actor";
import { requirePortalActor } from "@/lib/auth/rbac";
import { createOrderForInvoice } from "@/lib/services/payment.service";
import { isPaymentsConfigured } from "@/lib/payments";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Open a gateway order for one of the signed-in client's own invoices.
 *
 * The invoice is resolved by id **and** the session's clientId, so a client
 * cannot open an order against someone else's bill (CLAUDE.md 2 rule 3).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const orderLog = log("payments");

const bodySchema = z.object({ invoiceId: z.string().trim().min(1).max(40) });

export async function POST(request: Request): Promise<NextResponse> {
  const actor = requirePortalActorOrNull(await currentActor());
  if (!actor) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  if (!isPaymentsConfigured()) {
    return NextResponse.json({ error: "Online payment is not available." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "That invoice is not valid." }, { status: 400 });
  }

  try {
    const order = await createOrderForInvoice(parsed.data.invoiceId, actor.clientId);
    return NextResponse.json(order);
  } catch (error) {
    orderLog.warn({ err: error }, "order creation refused");

    if (isAppError(error)) {
      const status = error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }

    return NextResponse.json({ error: "That payment could not be started." }, { status: 500 });
  }
}

/** Narrow without throwing, so an unauthenticated caller gets a 401. */
function requirePortalActorOrNull(actor: Awaited<ReturnType<typeof currentActor>>) {
  try {
    return requirePortalActor(actor);
  } catch {
    return null;
  }
}
