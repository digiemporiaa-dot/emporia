import type { SocialProvider } from "@/generated/prisma/enums";

/**
 * Which permissions an account actually holds (brief §36, "permission changes").
 *
 * A platform's consent screen can let a person untick individual permissions,
 * so what was *asked for* says nothing about what was *granted*. Before this,
 * every adapter reported the permissions it requested, and an account missing
 * the one that publishes read as healthy until its first post failed.
 *
 * So granted permissions come only from what a platform says it granted — the
 * `scope` of an OAuth token response, Instagram's `permissions`, Facebook's
 * permissions edge — and travel with the credentials. When a platform says
 * nothing, the answer is "not reported", never the requested list.
 */

/**
 * The permissions publishing needs, per platform. Each is one the adapter
 * already requests; this is the subset without which a post cannot go out.
 */
export const PUBLISH_SCOPES: Record<SocialProvider, readonly string[]> = {
  LINKEDIN: ["w_member_social"],
  INSTAGRAM: ["instagram_business_content_publish"],
  FACEBOOK: ["pages_manage_posts"],
  YOUTUBE: ["https://www.googleapis.com/auth/youtube.upload"],
  X: ["tweet.write", "media.write"],
  GOOGLE_BUSINESS_PROFILE: ["https://www.googleapis.com/auth/business.manage"],
};

/**
 * A granted-permissions field from a platform response.
 *
 * Accepts the shapes platforms actually use: one string separated by spaces
 * (RFC 6749, X, Google) or commas (LinkedIn, Instagram), or an array of
 * strings. Anything else — absent, empty, the wrong type — is "not reported"
 * (null), so a missing field can never read as "granted nothing".
 */
export function parseGrantedScopes(value: unknown): string[] | null {
  const parts = typeof value === "string"
    ? value.split(/[\s,]+/)
    : Array.isArray(value)
      ? value.filter((part): part is string => typeof part === "string")
      : [];
  const scopes = [...new Set(parts.map((part) => part.trim()).filter(Boolean))].sort();
  return scopes.length > 0 ? scopes : null;
}

/**
 * Publishing permissions the account is known to lack.
 *
 * Empty when the platform never reported its grants: unknown is not missing,
 * and warning about it would be a guess dressed as a fact.
 */
export function missingPublishScopes(
  provider: SocialProvider,
  account: { scopes: readonly string[]; scopesReportedAt: Date | string | null },
): string[] {
  if (!account.scopesReportedAt) return [];
  const granted = new Set(account.scopes);
  return PUBLISH_SCOPES[provider].filter((scope) => !granted.has(scope));
}
