import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { db } from "@/lib/db";
import { socialProvider } from "@/lib/social";
import {
  OAUTH_STATE_COOKIE,
  PORTAL_ACCOUNTS_PATH,
  callbackUrl,
  flowClient,
  issueState,
  pkceVerifier,
} from "@/lib/social/oauth-state";
import { siteOrigin } from "@/lib/seo/urls";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import type { SocialProvider } from "@/generated/prisma/enums";

/**
 * Begin connecting a client's social account.
 *
 * A route handler rather than a server action because the browser has to be
 * *redirected* to the provider, and the flow returns through a callback URL
 * the provider was registered with.
 *
 * Everything this route trusts is established here, before the redirect: who
 * the operator is, that they may manage this client's accounts, that the
 * client exists, and that the provider is configured. The client id is then
 * signed into the OAuth `state` — so when the browser comes back, the callback
 * reads which client this was for from a value it signed itself rather than
 * from a query parameter (CLAUDE.md 2 rule 3).
 *
 * A client's portal user may start it too, for their own client only: the
 * client comes from the session and any `clientId` in the query is ignored.
 * Their state is marked `via: "portal"`, so it comes back to the portal and
 * can only be finished by a portal user of the same client.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const routeLog = log("social");

const PROVIDERS: Record<string, SocialProvider> = {
  instagram: "INSTAGRAM",
  facebook: "FACEBOOK",
  linkedin: "LINKEDIN",
  youtube: "YOUTUBE",
  x: "X",
  google_business_profile: "GOOGLE_BUSINESS_PROFILE",
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  const actor = await currentActor();
  if (!actor) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const flow = flowClient(actor, new URL(request.url).searchParams.get("clientId"));
  if (!flow) {
    return NextResponse.json({ error: "You cannot manage social accounts." }, { status: 403 });
  }
  const { portal } = flow;

  const { provider: slug } = await params;
  const provider = PROVIDERS[slug];
  if (!provider) {
    return NextResponse.json({ error: "There is no such provider." }, { status: 404 });
  }

  // A portal user's client is their session's, whatever the URL says.
  const { clientId } = flow;
  if (!clientId) {
    return NextResponse.json({ error: "No client was named." }, { status: 400 });
  }

  const client = await db.client.findFirst({
    where: { id: clientId, deletedAt: null },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ error: "That client does not exist." }, { status: 404 });
  }

  const adapter = await socialProvider(provider);
  if (!adapter.configured) {
    // A client cannot fix the agency's settings: back to their page, where
    // the platform is simply not offered.
    if (portal) return portalBack("unconfigured");
    // Honest, and actionable: the operator is told what to do rather than
    // being bounced to a provider that will reject the request.
    return NextResponse.json(
      { error: `${adapter.label} is not configured. Add its app credentials in Settings first.` },
      { status: 503 },
    );
  }

  const returnTo = portal ? PORTAL_ACCOUNTS_PATH : `/admin/clients/${client.id}/social/accounts`;
  const { state, nonce } = issueState({
    clientId: client.id,
    provider,
    returnTo,
    ...(portal ? { via: "portal" as const } : {}),
  });

  let authorizeUrl: string;
  try {
    authorizeUrl = adapter.authorizationUrl(state, callbackUrl(provider), {
      verifier: pkceVerifier(nonce),
    });
  } catch (error) {
    if (portal) {
      routeLog.error({ err: error, provider }, "could not build a portal authorization url");
      return portalBack("failed");
    }
    if (isAppError(error)) {
      return NextResponse.json({ error: error.publicMessage }, { status: error.status });
    }
    routeLog.error({ err: error, provider }, "could not build an authorization url");
    return NextResponse.json({ error: "That connection could not be started." }, { status: 500 });
  }

  const response = NextResponse.redirect(authorizeUrl);
  // The half of the CSRF defence an attacker cannot forge. Short-lived,
  // httpOnly, and scoped to the callback path.
  response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/social/oauth",
    maxAge: 600,
  });

  routeLog.info({ provider, clientId: client.id, actorId: actor.userId, portal }, "oauth flow started");
  return response;
}

/** A client never lands on a JSON error: back to their accounts page with the outcome. */
function portalBack(outcome: string): NextResponse {
  const target = new URL(PORTAL_ACCOUNTS_PATH, siteOrigin());
  target.searchParams.set("connection", outcome);
  return NextResponse.redirect(target);
}
