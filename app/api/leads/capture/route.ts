import { NextResponse } from "next/server";
import { popupLeadSchema } from "@/lib/validation/popup-lead";
import { capturePopupLead } from "@/lib/services/lead.service";
import { readVisitorContext, resolvePageContext } from "@/lib/attribution/server";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { clientIpFrom } from "@/lib/auth";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { headers } from "next/headers";

/**
 * Public popup submission.
 *
 * A route handler rather than a server action because it is a public,
 * unauthenticated entry point (CLAUDE.md 3). Rate limited, zod validated, and
 * attribution is read from cookies and headers rather than the body.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const head = await headers();
  const ip = clientIpFrom(head);

  const limit = checkRateLimit(`lead:capture:${ip ?? "unknown"}`, {
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, message: "Too many submissions. Please try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let parsed;
  try {
    parsed = popupLeadSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { ok: false, message: "Please check the details and try again." },
      { status: 422 },
    );
  }

  // Honeypot: report success without writing, so a bot learns nothing from
  // the difference between outcomes.
  if (parsed.website) {
    log("popup").info("honeypot triggered on popup form");
    return NextResponse.json({ ok: true });
  }

  try {
    const [visitor, context] = await Promise.all([
      readVisitorContext(),
      resolvePageContext(parsed.path),
    ]);

    await capturePopupLead(
      {
        popupId: parsed.popupId,
        name: parsed.name,
        email: parsed.email,
        phone: parsed.phone || null,
        company: parsed.company || null,
        message: parsed.message || null,
      },
      {
        visitor,
        path: parsed.path,
        serviceId: context.serviceId,
        cityId: context.cityId,
        packageId: context.packageId,
      },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json(
        { ok: false, message: error.publicMessage },
        { status: error.status },
      );
    }
    log("popup").error({ err: error }, "popup lead capture failed");
    return NextResponse.json(
      { ok: false, message: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
