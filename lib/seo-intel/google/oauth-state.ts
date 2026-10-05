import "server-only";
import { issueSignedState, readSignedState, type SignedStateFailure } from "@/lib/security/signed-state";

/**
 * The OAuth `state` for connecting Search Console or Analytics: carries which property and source the
 * sign-in is for, signed, and bound to the starting browser by a cookie nonce
 * (lib/security/signed-state). Its own purpose key, so a social-accounts state
 * cannot be replayed here.
 */

const PURPOSE = "seo-google-oauth";
const MAX_AGE_MS = 10 * 60 * 1000;

export const SEO_OAUTH_COOKIE = "emporia.seo.oauth";
export const SEO_OAUTH_COOKIE_PATH = "/api/seo/google";

/**
 * `via` records which side started the flow, so the callback completes it
 * under the same rules: a portal state is only ever completed by that
 * client's own user, a staff state only by staff who may connect.
 */
export type SeoOAuthState = { propertyId: string; source: "SEARCH_CONSOLE" | "ANALYTICS"; via: "staff" | "portal" };

export function issueSeoState(input: SeoOAuthState): { state: string; nonce: string } {
  return issueSignedState(PURPOSE, input);
}

export function readSeoState(
  state: string | null,
  cookieNonce: string | null,
): { ok: true; value: SeoOAuthState } | { ok: false; reason: SignedStateFailure } {
  return readSignedState<SeoOAuthState>(PURPOSE, state, cookieNonce, {
    maxAgeMs: MAX_AGE_MS,
    isPayload: (value) =>
      typeof value["propertyId"] === "string" &&
      // Analytics is connected by staff only; the portal connects Search Console.
      ((value["source"] === "SEARCH_CONSOLE" && (value["via"] === "staff" || value["via"] === "portal")) ||
        (value["source"] === "ANALYTICS" && value["via"] === "staff")),
  });
}
