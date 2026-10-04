import { NextResponse } from "next/server";
import { siteOrigin } from "@/lib/seo/urls";
import { currentActor } from "@/lib/actor";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { ensurePortalProperty, portalGscAuthorizationUrl } from "@/lib/services/onboarding.service";
import { issueSeoState, SEO_OAUTH_COOKIE, SEO_OAUTH_COOKIE_PATH } from "@/lib/seo-intel/google/oauth-state";
import type { PortalActor } from "@/lib/actor/types";

/**
 * A client connects their own Search Console during onboarding.
 *
 * Only a portal user, only for their own client's website: the property is
 * resolved from the session (never from the query string) and signed into the
 * state with `via: "portal"`, so the shared callback finishes it under the
 * portal's rules.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const routeLog = log("onboarding");

export async function GET(): Promise<NextResponse> {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (actor.type !== "CLIENT" || !actor.clientId) {
    return NextResponse.json({ error: "This is for client accounts." }, { status: 403 });
  }
  const portalActor = actor as PortalActor;

  let authorizeUrl: string;
  let nonce: string;
  try {
    const propertyId = await ensurePortalProperty(portalActor);
    const issued = issueSeoState({ propertyId, source: "SEARCH_CONSOLE", via: "portal" });
    nonce = issued.nonce;
    authorizeUrl = await portalGscAuthorizationUrl(portalActor, propertyId, issued.state);
  } catch (error) {
    // Back to the checklist with the reason — a client should never land on a JSON error.
    if (isAppError(error)) {
      const target = new URL("/portal/onboarding", siteOrigin());
      target.searchParams.set("connection", "failed");
      target.searchParams.set("reason", error.publicMessage.slice(0, 200));
      return NextResponse.redirect(target);
    }
    routeLog.error({ err: error, clientId: actor.clientId }, "could not start the portal search console sign-in");
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
  return response;
}
