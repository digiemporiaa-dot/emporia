import { NextResponse } from "next/server";
import { currentActor } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { socialProvider } from "@/lib/social";
import { OAUTH_STATE_COOKIE, callbackUrl, issueState } from "@/lib/social/oauth-state";
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
  if (!can(actor, "social.accounts.manage")) {
    return NextResponse.json({ error: "You cannot manage social accounts." }, { status: 403 });
  }

  const { provider: slug } = await params;
  const provider = PROVIDERS[slug];
  if (!provider) {
    return NextResponse.json({ error: "There is no such provider." }, { status: 404 });
  }

  const clientId = new URL(request.url).searchParams.get("clientId");
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
    // Honest, and actionable: the operator is told what to do rather than
    // being bounced to a provider that will reject the request.
    return NextResponse.json(
      { error: `${adapter.label} is not configured. Add its app credentials in Settings first.` },
      { status: 503 },
    );
  }

  const returnTo = `/admin/clients/${client.id}/social/accounts`;
  const { state, nonce } = issueState({ clientId: client.id, provider, returnTo });

  let authorizeUrl: string;
  try {
    authorizeUrl = adapter.authorizationUrl(state, callbackUrl(provider));
  } catch (error) {
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

  routeLog.info({ provider, clientId: client.id, actorId: actor.userId }, "oauth flow started");
  return response;
}
