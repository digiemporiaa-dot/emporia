import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { pageLeadSchema } from "@/lib/validation/page-lead";
import { capturePageFormLead } from "@/lib/services/lead.service";
import { readVisitorContext } from "@/lib/attribution/server";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { clientIpFrom } from "@/lib/auth";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { sendCapiEvent } from "@/lib/tracking/capi";
import { serverConsent } from "@/lib/tracking/consent-server";

/**
 * Public submission from a `leadForm` block on a CMS page.
 *
 * A route handler rather than a server action because it is a public,
 * unauthenticated entry point (CLAUDE.md 3). It is the popup endpoint's twin
 * and shares its posture: rate limited by IP, zod validated, honeypotted, and
 * attribution read from cookies and headers rather than from the body.
 *
 * The one thing it does differently is where the *configuration* comes from:
 * the browser names a section, and the service loads that section to decide
 * which service the lead belongs to and what to say back. See
 * `capturePageFormLead`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The page the form was submitted from, for Meta's `event_source_url`. */
function absoluteUrl(head: Headers, path: string): string | null {
  const host = head.get("host");
  if (!host) return null;
  const proto = head.get("x-forwarded-proto") ?? "https";
  try {
    return new URL(path, `${proto}://${host}`).toString();
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const head = await headers();
  const cookieStore = await cookies();
  const ip = clientIpFrom(head);

  const limit = await checkRateLimit(`lead:page-form:${ip ?? "unknown"}`, {
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
    parsed = pageLeadSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { ok: false, message: "Please check the details and try again." },
      { status: 422 },
    );
  }

  // Honeypot: report success without writing, so a bot learns nothing from the
  // difference between outcomes.
  if (parsed.website) {
    log("page-form").info("honeypot triggered on a page form");
    return NextResponse.json({ ok: true });
  }

  try {
    const visitor = await readVisitorContext();

    const result = await capturePageFormLead(
      {
        sectionId: parsed.sectionId,
        name: parsed.name || null,
        email: parsed.email,
        phone: parsed.phone || null,
        company: parsed.company || null,
        message: parsed.message || null,
      },
      { visitor, path: parsed.path },
    );

    // The server-side copy of the conversion, sharing the browser's event id so
    // Meta counts one lead rather than two. Consent is checked here as well as
    // in the browser: sending the same data through a different pipe is not a
    // way around a visitor who said no.
    if (parsed.eventId) {
      const consent = await serverConsent();
      if (consent.marketing) {
        await sendCapiEvent({
          eventName: "Lead",
          eventId: parsed.eventId,
          sourceUrl: absoluteUrl(head, parsed.path),
          clientIp: ip,
          userAgent: head.get("user-agent"),
          fbp: cookieStore.get("_fbp")?.value ?? null,
          fbc: cookieStore.get("_fbc")?.value ?? null,
          email: parsed.email,
          phone: parsed.phone || null,
        });
      }
    }

    return NextResponse.json({ ok: true, message: result.successMessage });
  } catch (error) {
    if (isAppError(error)) {
      return NextResponse.json(
        { ok: false, message: error.publicMessage, details: error.details },
        { status: error.status },
      );
    }
    log("page-form").error({ err: error }, "page form lead capture failed");
    return NextResponse.json(
      { ok: false, message: "Something went wrong. Please try again." },
      { status: 500 },
    );
  }
}
