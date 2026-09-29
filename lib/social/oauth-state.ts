import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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

function key(): Buffer {
  return createHash("sha256").update(`${env().AUTH_SECRET}:social-oauth`).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(payload).digest("base64url");
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** Build the state to send, plus the nonce to store in the cookie. */
export function issueState(input: {
  clientId: string;
  provider: SocialProvider;
  returnTo: string;
}): { state: string; nonce: string } {
  const nonce = randomBytes(24).toString("base64url");
  const payload: OAuthState = { ...input, nonce, issuedAt: Date.now() };
  const body = encode(payload);
  return { state: `${body}.${sign(body)}`, nonce };
}

export type StateResult =
  | { ok: true; value: OAuthState }
  | { ok: false; reason: "malformed" | "signature" | "expired" | "nonce" };

/**
 * Read a state back, refusing anything that is not exactly what we issued.
 *
 * Returns a reason rather than throwing so the callback can log which check
 * failed — a signature mismatch and an expired flow want different words on
 * the screen — while telling the operator the same generic thing.
 */
export function readState(state: string | null, cookieNonce: string | null): StateResult {
  if (!state) return { ok: false, reason: "malformed" };

  const at = state.lastIndexOf(".");
  if (at <= 0) return { ok: false, reason: "malformed" };

  const body = state.slice(0, at);
  const signature = state.slice(at + 1);

  const expected = Buffer.from(sign(body), "utf8");
  const given = Buffer.from(signature, "utf8");
  // Length-checked first: timingSafeEqual throws on a mismatch.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "signature" };
  }

  let payload: OAuthState;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (
    typeof payload.clientId !== "string" ||
    typeof payload.provider !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.issuedAt !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (Date.now() - payload.issuedAt > MAX_AGE_MS) return { ok: false, reason: "expired" };

  // The half an attacker cannot supply: the nonce lives in an httpOnly cookie
  // on the browser that started the flow.
  if (!cookieNonce) return { ok: false, reason: "nonce" };
  const a = Buffer.from(payload.nonce, "utf8");
  const b = Buffer.from(cookieNonce, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "nonce" };

  return { ok: true, value: payload };
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
  return createHmac("sha256", key()).update(`pkce:${nonce}`).digest("base64url");
}

/** The S256 challenge sent in place of the verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
