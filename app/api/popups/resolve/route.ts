import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import {
  COOKIE,
  COOKIE_MAX_AGE,
  decodePopupState,
  encodePopupState,
  deviceFromUserAgent,
} from "@/lib/attribution/cookies";
import { resolveForPage, recordEvent } from "@/lib/services/popup.service";
import { resolvePageContext } from "@/lib/attribution/server";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { clientIpFrom } from "@/lib/auth";
import { log } from "@/lib/logger";

/**
 * Server-side popup resolution.
 *
 * The client sends only the path it is on. Everything that decides the outcome
 * — device, new versus returning, frequency state, schedule, targeting rules,
 * priority — is derived on the server from headers and httpOnly cookies, and
 * the response carries at most one popup (CLAUDE.md 10).
 *
 * The client is not trusted with its own frequency state: the `em_pop` cookie
 * is httpOnly and written here, so a visitor cannot clear a localStorage key to
 * see a once-per-user popup again.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  path: z.string().min(1).max(2048),
});

export async function POST(request: Request): Promise<NextResponse> {
  const [jar, head] = await Promise.all([cookies(), headers()]);

  const ip = clientIpFrom(head);
  const limit = await checkRateLimit(`popup:resolve:${ip ?? "unknown"}`, { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json({ popup: null }, { status: 429 });
  }

  let parsed: { path: string };
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ popup: null }, { status: 400 });
  }

  const visitorId = jar.get(COOKIE.visitorId)?.value;
  if (!visitorId) {
    // No visitor cookie yet: middleware sets it on the document request, so
    // this is either a very early call or a client that rejects cookies.
    return NextResponse.json({ popup: null });
  }

  const seen = decodePopupState(jar.get(COOKIE.popupState)?.value);
  const sessionSeen = decodePopupState(jar.get(`${COOKIE.popupState}_s`)?.value);

  const context = await resolvePageContext(parsed.path);

  const popup = await resolveForPage(
    { path: parsed.path, ...context },
    {
      device: deviceFromUserAgent(head.get("user-agent")),
      isNewVisitor: !jar.get(COOKIE.firstTouch) && !jar.get(COOKIE.lastTouch),
      seen,
      seenThisSession: Object.keys(sessionSeen),
      now: new Date(),
    },
  );

  if (!popup) return NextResponse.json({ popup: null });

  const response = NextResponse.json({ popup });

  // Mark it shown now rather than waiting for the client to confirm: a client
  // that never reports back must not be able to replay the same popup.
  const now = Date.now();
  const secure = new URL(request.url).protocol === "https:";
  const base = { httpOnly: true, sameSite: "lax", path: "/", secure } as const;

  response.cookies.set(COOKIE.popupState, encodePopupState({ ...seen, [popup.id]: now }), {
    ...base,
    maxAge: COOKIE_MAX_AGE.popupState,
  });
  response.cookies.set(
    `${COOKIE.popupState}_s`,
    encodePopupState({ ...sessionSeen, [popup.id]: now }),
    base,
  );

  await recordEvent({
    popupId: popup.id,
    event: "IMPRESSION",
    visitorId,
    path: parsed.path,
    serviceId: context.serviceId,
    cityId: context.cityId,
  });

  log("popup").info({ popupId: popup.id, path: parsed.path }, "popup resolved");

  return response;
}
