import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { COOKIE } from "@/lib/attribution/cookies";
import { recordExposure } from "@/lib/services/experiment.service";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/utils/rate-limit";

/**
 * "This visitor saw this arm."
 *
 * A beacon from the page, after it has rendered, rather than a write during the
 * render itself: counting a sample must never sit on the critical path of
 * serving one. It follows the popup event route exactly, for the same reasons.
 *
 * The body is a claim, so it is checked rather than trusted. The server
 * re-derives nothing from the client except *which* experiment is being
 * reported; that the variant belongs to that experiment, and that the
 * experiment is running, are verified here. A client cannot inflate an arm it
 * was not shown, because the exposure is unique per visitor per experiment and
 * the visitor id comes from the cookie, not the body.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  experimentId: z.string().min(1).max(40),
  variantId: z.string().min(1).max(40),
});

export async function POST(request: Request): Promise<NextResponse> {
  const jar = await cookies();
  const visitorId = jar.get(COOKIE.visitorId)?.value;
  // No cookie means no stable identity, and an exposure without one would
  // inflate the denominator with the same person counted repeatedly.
  // 204 carries no body — `NextResponse.json` with this status throws
  // "Invalid response status code 204" and turns a quiet no-op into a 500.
  if (!visitorId) return new NextResponse(null, { status: 204 });

  const limit = await checkRateLimit(`experiment:exposure:${visitorId}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) return NextResponse.json({ ok: false }, { status: 429 });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // The arm must belong to the experiment named, and the experiment must be
  // running. Otherwise a stale page could keep adding to a stopped test's
  // sample, which would quietly change a result somebody has already read.
  const variant = await db.experimentVariant.findFirst({
    where: {
      id: parsed.variantId,
      experimentId: parsed.experimentId,
      experiment: { status: "RUNNING" },
    },
    select: { id: true },
  });
  if (!variant) return new NextResponse(null, { status: 204 });

  await recordExposure({
    experimentId: parsed.experimentId,
    variantId: parsed.variantId,
    visitorId,
  });

  return NextResponse.json({ ok: true });
}
