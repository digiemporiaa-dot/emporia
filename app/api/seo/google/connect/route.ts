import { NextResponse } from "next/server";
import { z } from "zod";
import { currentActor } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { gscAuthorizationUrl } from "@/lib/services/seo-intel/gsc-connection.service";
import { ga4AuthorizationUrl } from "@/lib/services/seo-intel/ga4-connection.service";
import { issueSeoState, SEO_OAUTH_COOKIE, SEO_OAUTH_COOKIE_PATH } from "@/lib/seo-intel/google/oauth-state";

/**
 * Begin "Sign in with Google" for a property's Search Console, or its
 * Analytics with `?source=ANALYTICS`.
 *
 * A route handler because the browser has to be redirected to Google. Who the
 * operator is, that they may connect, and that the property exists are all
 * settled here; the property id then rides in the signed state, so the
 * callback never reads it from the browser.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const routeLog = log("seo-intel");

export async function GET(request: Request): Promise<NextResponse> {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(actor, "seo.intelligence.connect")) {
    return NextResponse.json({ error: "You cannot connect data sources." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const parsedId = z.string().regex(/^[a-z0-9]{8,40}$/).safeParse(params.get("propertyId"));
  if (!parsedId.success) return NextResponse.json({ error: "No website was named." }, { status: 400 });
  const propertyId = parsedId.data;
  const source = params.get("source") === "ANALYTICS" ? "ANALYTICS" : "SEARCH_CONSOLE";

  const { state, nonce } = issueSeoState({ propertyId, source, via: "staff" });
  let authorizeUrl: string;
  try {
    authorizeUrl = source === "ANALYTICS" ? await ga4AuthorizationUrl(actor, propertyId, state) : await gscAuthorizationUrl(actor, propertyId, state);
  } catch (error) {
    if (isAppError(error)) return NextResponse.json({ error: error.publicMessage }, { status: error.status });
    routeLog.error({ err: error, propertyId }, "could not start the search console sign-in");
    return NextResponse.json({ error: "That connection could not be started." }, { status: 500 });
  }

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(SEO_OAUTH_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: SEO_OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  routeLog.info({ propertyId, source, actorId: actor.userId }, "google sign-in started");
  return response;
}
