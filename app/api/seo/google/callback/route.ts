import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentActor } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { siteOrigin } from "@/lib/seo/urls";
import { completeGscOAuth } from "@/lib/services/seo-intel/gsc-connection.service";
import { completeGa4OAuth } from "@/lib/services/seo-intel/ga4-connection.service";
import { portalCompleteGsc } from "@/lib/services/onboarding.service";
import type { PortalActor } from "@/lib/actor/types";
import { readSeoState, SEO_OAUTH_COOKIE, SEO_OAUTH_COOKIE_PATH } from "@/lib/seo-intel/google/oauth-state";

/**
 * Google sends the browser back here. The property comes from the signed
 * state (checked against the cookie nonce), never from the query string; the
 * grant is stored encrypted, and the operator chooses the Search Console
 * property next.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const routeLog = log("seo-intel");

function back(propertyId: string | null, outcome: string, via: "staff" | "portal" = "staff", source: "SEARCH_CONSOLE" | "ANALYTICS" = "SEARCH_CONSOLE"): NextResponse {
  const path =
    via === "portal"
      ? "/portal/onboarding"
      : propertyId
        ? `/admin/marketing/seo/properties/${propertyId}/${source === "ANALYTICS" ? "analytics" : "search-console"}`
        : "/admin/marketing/seo";
  const target = new URL(path, siteOrigin());
  target.searchParams.set("connection", outcome);
  const response = NextResponse.redirect(target);
  // The flow is over either way; the nonce must not be reusable.
  response.cookies.set(SEO_OAUTH_COOKIE, "", { path: SEO_OAUTH_COOKIE_PATH, maxAge: 0 });
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const url = new URL(request.url);
  const jar = await cookies();
  const state = readSeoState(url.searchParams.get("state"), jar.get(SEO_OAUTH_COOKIE)?.value ?? null);
  if (!state.ok) {
    routeLog.warn({ reason: state.reason }, "search console callback rejected");
    return NextResponse.json({ error: "That connection could not be verified. Start again from the website's Search Console page." }, { status: 400 });
  }
  const { propertyId, via, source } = state.value;

  // A flow completes under the rules it started with: a portal flow only for
  // a portal user (whose own client must own the property — checked again in
  // the service), a staff flow only for staff who may connect.
  const portal = via === "portal";
  if (portal ? actor.type !== "CLIENT" || !actor.clientId : !can(actor, "seo.intelligence.connect")) {
    routeLog.warn({ propertyId, via, actorType: actor.type }, "search console callback from the wrong side");
    return NextResponse.json({ error: "That connection could not be verified." }, { status: 403 });
  }

  if (url.searchParams.get("error")) return back(propertyId, "cancelled", via, source);
  const code = url.searchParams.get("code");
  if (!code) return back(propertyId, "cancelled", via, source);

  try {
    if (portal) await portalCompleteGsc(actor as PortalActor, propertyId, code);
    else if (source === "ANALYTICS") await completeGa4OAuth(actor, propertyId, code);
    else await completeGscOAuth(actor, propertyId, code);
    return back(propertyId, "signed-in", via, source);
  } catch (error) {
    routeLog.warn({ err: error, propertyId, source }, "google sign-in failed");
    const message = isAppError(error) ? error.publicMessage : "Google sign-in failed.";
    const response = back(propertyId, "failed", via, source);
    const target = new URL(response.headers.get("location") as string);
    target.searchParams.set("reason", message.slice(0, 200));
    response.headers.set("location", target.toString());
    return response;
  }
}
