import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/config/env";

/**
 * A signed, short-lived OAuth `state`, bound to the browser that started the
 * flow.
 *
 * Shared by every OAuth round trip in the app (social accounts, Search
 * Console, Analytics). The payload — which client or property the flow is for
 * — is signed so the callback can trust it instead of a query parameter; the
 * nonce inside it is also set in an httpOnly cookie, so a state lifted from a
 * URL is useless without the victim's browser (login CSRF).
 *
 * Each caller passes its own `purpose`: the signing key is derived from
 * `AUTH_SECRET` and the purpose, so a state minted for one flow cannot be
 * replayed into another.
 */

function key(purpose: string): Buffer {
  return createHash("sha256").update(`${env().AUTH_SECRET}:${purpose}`).digest();
}

function sign(purpose: string, payload: string): string {
  return createHmac("sha256", key(purpose)).update(payload).digest("base64url");
}

export type SignedStateFailure = "malformed" | "signature" | "expired" | "nonce";

/** Sign `payload` (plus a fresh nonce and the time) into a state; returns the nonce for the cookie. */
export function issueSignedState<T extends object>(purpose: string, payload: T): { state: string; nonce: string } {
  const nonce = randomBytes(24).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...payload, nonce, issuedAt: Date.now() }), "utf8").toString("base64url");
  return { state: `${body}.${sign(purpose, body)}`, nonce };
}

/**
 * Read a state back, refusing anything that is not exactly what was issued:
 * a bad signature, an expired flow, or a nonce that does not match the
 * cookie. `isPayload` checks the caller's own fields.
 */
export function readSignedState<T>(
  purpose: string,
  state: string | null,
  cookieNonce: string | null,
  options: { maxAgeMs: number; isPayload: (value: Record<string, unknown>) => boolean },
): { ok: true; value: T & { nonce: string; issuedAt: number } } | { ok: false; reason: SignedStateFailure } {
  if (!state) return { ok: false, reason: "malformed" };

  const at = state.lastIndexOf(".");
  if (at <= 0) return { ok: false, reason: "malformed" };

  const body = state.slice(0, at);
  const expected = Buffer.from(sign(purpose, body), "utf8");
  const given = Buffer.from(state.slice(at + 1), "utf8");
  // Length-checked first: timingSafeEqual throws on a mismatch.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "signature" };
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return { ok: false, reason: "malformed" };
    payload = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (typeof payload["nonce"] !== "string" || typeof payload["issuedAt"] !== "number" || !options.isPayload(payload)) {
    return { ok: false, reason: "malformed" };
  }
  if (Date.now() - (payload["issuedAt"] as number) > options.maxAgeMs) return { ok: false, reason: "expired" };

  // The half an attacker cannot supply: the nonce lives in an httpOnly cookie
  // on the browser that started the flow.
  if (!cookieNonce) return { ok: false, reason: "nonce" };
  const a = Buffer.from(payload["nonce"] as string, "utf8");
  const b = Buffer.from(cookieNonce, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "nonce" };

  return { ok: true, value: payload as T & { nonce: string; issuedAt: number } };
}

/** An HMAC of `value` under the purpose's key — e.g. a PKCE verifier derived from a nonce. */
export function derivedSecret(purpose: string, value: string): string {
  return createHmac("sha256", key(purpose)).update(value).digest("base64url");
}
