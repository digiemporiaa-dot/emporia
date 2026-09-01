import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { COOKIE } from "@/lib/attribution/cookies";
import { recordEvent } from "@/lib/services/popup.service";
import { resolvePageContext } from "@/lib/attribution/server";
import { checkRateLimit } from "@/lib/utils/rate-limit";

/**
 * Popup analytics events from the client: VIEW and FORM_START.
 *
 * SUBMISSION and CONVERSION are recorded server-side by the lead capture
 * endpoint instead, because a client claiming a conversion is not evidence of
 * one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  popupId: z.string().min(1).max(40),
  event: z.enum(["VIEW", "FORM_START"]),
  path: z.string().min(1).max(2048),
});

export async function POST(request: Request): Promise<NextResponse> {
  const jar = await cookies();
  const visitorId = jar.get(COOKIE.visitorId)?.value;
  if (!visitorId) return NextResponse.json({ ok: false }, { status: 204 });

  const limit = checkRateLimit(`popup:event:${visitorId}`, { limit: 120, windowMs: 60_000 });
  if (!limit.allowed) return NextResponse.json({ ok: false }, { status: 429 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const context = await resolvePageContext(parsed.path);

  await recordEvent({
    popupId: parsed.popupId,
    event: parsed.event,
    visitorId,
    path: parsed.path,
    serviceId: context.serviceId,
    cityId: context.cityId,
  });

  return NextResponse.json({ ok: true });
}
