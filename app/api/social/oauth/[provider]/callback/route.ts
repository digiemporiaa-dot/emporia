import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentActor } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { socialProvider } from "@/lib/social";
import { OAUTH_STATE_COOKIE, callbackUrl, readState } from "@/lib/social/oauth-state";
import { assertConnectable, connectAccount } from "@/lib/services/social-account.service";
import { startPendingConnection } from "@/lib/services/social-pending.service";
import { isAppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { siteOrigin } from "@/lib/seo/urls";
import type { SocialProvider } from "@/generated/prisma/enums";

/**
 * Where the provider sends the browser back.
 *
 * This is the route that must not be fooled. It is reachable by anyone with a
 * URL, so it re-establishes everything rather than assuming the flow that
 * started is the flow that finished:
 *
 * - the operator is signed in, and may still manage social accounts;
 * - the `state` carries our own signature, has not expired, and matches the
 *   nonce in the httpOnly cookie set when the flow began;
 * - the client comes from that signed state, never from the query string;
 * - the provider's own account response is validated before anything is saved.
 *
 * An attacker who obtains a victim's callback URL still fails on the cookie; an
 * attacker who forges a state still fails on the signature. Either way nothing
 * is written.
 *
 * The operator is redirected back with a short outcome in the query string —
 * never the provider's raw error, which can echo the request and with it the
 * client secret.
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

/**
 * Send the operator back where they started, with the outcome.
 *
 * `to` came out of our own signed state, but it is still checked for being a
 * relative path: an open redirect built from a value we signed an hour ago is
 * still an open redirect, and the check costs one line.
 */
function back(to: string, outcome: string): NextResponse {
  const path = to.startsWith("/") && !to.startsWith("//") ? to : "/admin/clients";
  const target = new URL(path, siteOrigin());
  target.searchParams.set("connection", outcome);

  const response = NextResponse.redirect(target);
  // The flow is over either way; the nonce must not be reusable.
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

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

  const url = new URL(request.url);
  const jar = await cookies();
  const state = readState(url.searchParams.get("state"), jar.get(OAUTH_STATE_COOKIE)?.value ?? null);

  if (!state.ok) {
    // The reason is logged, not shown: which check failed is useful to us and
    // to nobody else.
    routeLog.warn({ provider, reason: state.reason }, "oauth callback rejected");
    return NextResponse.json(
      { error: "That connection could not be verified. Start again from the client's accounts page." },
      { status: 400 },
    );
  }

  if (state.value.provider !== provider) {
    routeLog.warn({ provider, stated: state.value.provider }, "oauth callback provider mismatch");
    return NextResponse.json({ error: "That connection could not be verified." }, { status: 400 });
  }

  // The operator declined, or the provider refused. Not an error worth a stack
  // trace — they simply did not connect.
  const denied = url.searchParams.get("error");
  if (denied) {
    routeLog.info({ provider, denied }, "oauth flow declined");
    return back(state.value.returnTo, "cancelled");
  }

  const code = url.searchParams.get("code");
  if (!code) return back(state.value.returnTo, "cancelled");

  const adapter = await socialProvider(provider);
  if (!adapter.configured) return back(state.value.returnTo, "unconfigured");

  try {
    const credentials = await adapter.exchangeCode(code, callbackUrl(provider));

    // One sign-in, several accounts (a Facebook user's Pages). With exactly
    // one there is nothing to ask; otherwise the operator chooses, and the
    // grant waits server-side — encrypted, minutes, never in the browser.
    if (adapter.listAccounts && adapter.selectAccount) {
      const accounts = await adapter.listAccounts(credentials);
      if (accounts.length === 0) return back(state.value.returnTo, "no-accounts");

      if (accounts.length > 1) {
        const pendingId = await startPendingConnection(actor, {
          clientId: state.value.clientId,
          provider,
          credentials,
          accounts,
          returnTo: state.value.returnTo,
        });
        const response = NextResponse.redirect(
          new URL(
            `/admin/clients/${state.value.clientId}/social/accounts/choose/${pendingId}`,
            siteOrigin(),
          ),
        );
        response.cookies.delete(OAUTH_STATE_COOKIE);
        return response;
      }

      const selected = await adapter.selectAccount(credentials, accounts[0]!.externalId);
      assertConnectable(selected.account);
      await connectAccount(actor, {
        clientId: state.value.clientId,
        provider,
        account: selected.account,
        credentials: selected.credentials,
      });
      return back(state.value.returnTo, "connected");
    }

    const account = await adapter.getAccount(credentials);
    assertConnectable(account);

    await connectAccount(actor, {
      clientId: state.value.clientId,
      provider,
      account,
      credentials,
    });

    return back(state.value.returnTo, "connected");
  } catch (error) {
    if (isAppError(error) && error.code === "CONFLICT") {
      return back(state.value.returnTo, "already-connected");
    }
    routeLog.error({ err: error, provider }, "oauth exchange failed");
    return back(state.value.returnTo, "failed");
  }
}
