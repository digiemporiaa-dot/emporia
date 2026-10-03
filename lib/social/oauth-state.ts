import "server-only";
import { createHash } from "node:crypto";
import { derivedSecret, issueSignedState, readSignedState, type SignedStateFailure } from "@/lib/security/signed-state";
import { env } from "@/lib/config/env";
import type { SocialProvider } from "@/generated/prisma/enums";

/**
 * The `state` parameter of an OAuth round trip.
 *
 * It does two jobs, and both matter:
 *
 * 1. **It carries which client we are connecting for.** The provider sends the
 *    browser back to one callback URL for everybody, so the callback has to
 *    learn the client from somewhere. Reading it from a query parameter the
 *    browser controls would be exactly the "never trust a clientId from the
 *    browser" failure the whole module is built to avoid — so the client id is
 *    signed into the state before the redirect and its signature is checked on
 *    the way back.
 *
 * 2. **It stops a cross-site request forgery.** Without it, an attacker can
 *    complete an OAuth flow with *their own* account's code against a logged-in
 *    victim's session, and the victim's client ends up connected to the
 *    attacker's Instagram.
 *
 * The signature alone is not enough for (2) — a signed state is still replayable
 * by whoever obtained it. So the state also carries a nonce, and the same nonce
 * is set in an httpOnly cookie at the start of the flow. The callback requires
 * both to be present and equal: an attacker can forge neither the signature nor
 * the victim's cookie.
 *
 * Signed with a key derived from `AUTH_SECRET`, like every other secret here,
 * so there is no new environment variable to forget.
 */

/** A flow older than this is stale; an operator can simply start again. */
const MAX_AGE_MS = 10 * 60 * 1000;

export const OAUTH_STATE_COOKIE = "emporia.social.oauth";

export type OAuthState = {
  clientId: string;
  provider: SocialProvider;
  nonce: string;
  issuedAt: number;
  /** Where to send the operator once the flow finishes. */
  returnTo: string;
};

const PURPOSE = "social-oauth";

/** Build the state to send, plus the nonce to store in the cookie. */
export function issueState(input: {
  clientId: string;
  provider: SocialProvider;
  returnTo: string;
}): { state: string; nonce: string } {
  return issueSignedState(PURPOSE, input);
}

export type StateResult =
  | { ok: true; value: OAuthState }
  | { ok: false; reason: SignedStateFailure };

/**
 * Read a state back, refusing anything that is not exactly what we issued.
 *
 * Returns a reason rather than throwing so the callback can log which check
 * failed — a signature mismatch and an expired flow want different words on
 * the screen — while telling the operator the same generic thing.
 */
export function readState(state: string | null, cookieNonce: string | null): StateResult {
  return readSignedState<OAuthState>(PURPOSE, state, cookieNonce, {
    maxAgeMs: MAX_AGE_MS,
    isPayload: (value) => typeof value["clientId"] === "string" && typeof value["provider"] === "string",
  });
}

/**
 * Where the provider sends the browser back.
 *
 * Built from `SITE_URL`, never from the incoming request: a redirect URI taken
 * from a `Host` header is a redirect URI an attacker can point at themselves,
 * and it has to match what is registered with the provider anyway.
 */
export function callbackUrl(provider: SocialProvider): string {
  const origin = env().SITE_URL.replace(/\/+$/, "");
  return `${origin}/api/social/oauth/${provider.toLowerCase()}/callback`;
}

/**
 * The PKCE code verifier for a flow, derived from its nonce.
 *
 * PKCE (X requires it) needs a secret the server remembers between sending
 * the browser away and the browser coming back. Rather than a new cookie or
 * table, it is an HMAC of the flow's nonce under a key from `AUTH_SECRET`:
 * the callback recomputes it from the verified state, and someone who reads
 * the state in a URL still cannot, without the key. 43 base64url characters,
 * the shortest a verifier may be and more than enough entropy.
 */
export function pkceVerifier(nonce: string): string {
  return derivedSecret(PURPOSE, `pkce:${nonce}`);
}

/** The S256 challenge sent in place of the verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
