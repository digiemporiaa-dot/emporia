import "server-only";
import { issueSignedState, readSignedState, type SignedStateFailure } from "@/lib/security/signed-state";

/**
 * The OAuth `state` for connecting Search Console: carries which property the
 * sign-in is for, signed, and bound to the starting browser by a cookie nonce
 * (lib/security/signed-state). Its own purpose key, so a social-accounts state
 * cannot be replayed here.
 */

const PURPOSE = "seo-google-oauth";
const MAX_AGE_MS = 10 * 60 * 1000;

export const SEO_OAUTH_COOKIE = "emporia.seo.oauth";
export const SEO_OAUTH_COOKIE_PATH = "/api/seo/google";

export type SeoOAuthState = { propertyId: string; source: "SEARCH_CONSOLE" };

export function issueSeoState(input: SeoOAuthState): { state: string; nonce: string } {
  return issueSignedState(PURPOSE, input);
}

export function readSeoState(
  state: string | null,
  cookieNonce: string | null,
): { ok: true; value: SeoOAuthState } | { ok: false; reason: SignedStateFailure } {
  return readSignedState<SeoOAuthState>(PURPOSE, state, cookieNonce, {
    maxAgeMs: MAX_AGE_MS,
    isPayload: (value) => typeof value["propertyId"] === "string" && value["source"] === "SEARCH_CONSOLE",
  });
}
