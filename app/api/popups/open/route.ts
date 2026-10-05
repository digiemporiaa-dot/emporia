import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { COOKIE } from "@/lib/attribution/cookies";
import { resolvePageContext } from "@/lib/attribution/server";
import { recordEvent, resolveButtonPopup } from "@/lib/services/popup.service";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { clientIpFrom } from "@/lib/auth";

/**
 * A button asked to open a popup.
 *
 * The button names the popup; the server decides whether it is live (switched
 * on, a button popup, inside its dates) and answers with at most that popup.
 * Frequency and targeting do not apply — the visitor clicked for it. The
 * impression is recorded with the page's attribution, like any other popup.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  popupId: z.string().regex(/^[a-z0-9]{8,40}$/),
  path: z.string().min(1).max(2048),
});

export async function POST(request: Request): Promise<NextResponse> {
  const [jar, head] = await Promise.all([cookies(), headers()]);
  const ip = clientIpFrom(head);
  const limit = await checkRateLimit(`popup:open:${ip ?? "unknown"}`, { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return NextResponse.json({ popup: null }, { status: 429 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ popup: null }, { status: 400 });
  }

  const popup = await resolveButtonPopup(parsed.popupId);
  if (!popup) return NextResponse.json({ popup: null });

  const visitorId = jar.get(COOKIE.visitorId)?.value;
  if (visitorId) {
    const context = await resolvePageContext(parsed.path);
    await recordEvent({ popupId: popup.id, event: "IMPRESSION", visitorId, path: parsed.path, serviceId: context.serviceId, cityId: context.cityId });
  }
  return NextResponse.json({ popup });
}
