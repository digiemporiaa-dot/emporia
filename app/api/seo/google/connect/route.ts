import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { gscAuthorizationUrl } from "@/lib/services/seo-intel/gsc-connection.service";
import { issueSeoState, SEO_OAUTH_COOKIE, SEO_OAUTH_COOKIE_PATH } from "@/lib/seo-intel/google/oauth-state";

/**
 * Begin "Sign in with Google" for a property's Search Console.
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

  const propertyId = new URL(request.url).searchParams.get("propertyId");
  if (!propertyId) return NextResponse.json({ error: "No website was named." }, { status: 400 });

  const { state, nonce } = issueSeoState({ propertyId, source: "SEARCH_CONSOLE", via: "staff" });
  let authorizeUrl: string;
  try {
    authorizeUrl = await gscAuthorizationUrl(actor, propertyId, state);
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
  routeLog.info({ propertyId, actorId: actor.userId }, "search console sign-in started");
  return response;
}
