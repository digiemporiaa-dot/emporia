import { describe, expect, it } from "vitest";
import { missingPublishScopes, parseGrantedScopes, PUBLISH_SCOPES } from "@/lib/social/scopes";
import { FACEBOOK_SCOPES } from "@/lib/social/facebook";
import { INSTAGRAM_SCOPES } from "@/lib/social/instagram";
import { LINKEDIN_SCOPES } from "@/lib/social/linkedin";
import { X_SCOPES } from "@/lib/social/x";
import { YOUTUBE_SCOPES } from "@/lib/social/youtube";
import { GOOGLE_BUSINESS_SCOPES } from "@/lib/social/google-business";

/**
 * Granted permissions (brief §36). Pinned: every shape a platform uses is
 * read; anything absent is "not reported", never "granted nothing"; and an
 * account is only said to lack a permission when the platform told us what it
 * granted.
 */

describe("reading a granted-permissions field", () => {
  it("reads space-separated, comma-separated and array forms, sorted and deduplicated", () => {
    expect(parseGrantedScopes("tweet.write users.read tweet.write")).toEqual(["tweet.write", "users.read"]);
    expect(parseGrantedScopes("w_member_social,openid, profile")).toEqual(["openid", "profile", "w_member_social"]);
    expect(parseGrantedScopes(["pages_manage_posts", 3, "read_insights"])).toEqual(["pages_manage_posts", "read_insights"]);
  });

  it("says nothing was reported rather than that nothing was granted", () => {
    for (const value of [undefined, null, "", "  ", [], 42, {}]) expect(parseGrantedScopes(value)).toBeNull();
  });
});

describe("which publishing permissions an account lacks", () => {
  it("names the missing one when the platform reported its grant", () => {
    expect(missingPublishScopes("FACEBOOK", { scopes: ["pages_show_list"], scopesReportedAt: new Date() })).toEqual(["pages_manage_posts"]);
    expect(missingPublishScopes("X", { scopes: ["tweet.write"], scopesReportedAt: new Date() })).toEqual(["media.write"]);
    expect(missingPublishScopes("LINKEDIN", { scopes: ["openid", "w_member_social"], scopesReportedAt: new Date() })).toEqual([]);
  });

  it("claims nothing is missing when the platform never said", () => {
    expect(missingPublishScopes("FACEBOOK", { scopes: [], scopesReportedAt: null })).toEqual([]);
  });

  it("only ever requires permissions each adapter actually asks for", () => {
    const requested = {
      FACEBOOK: FACEBOOK_SCOPES,
      INSTAGRAM: INSTAGRAM_SCOPES,
      LINKEDIN: LINKEDIN_SCOPES,
      X: X_SCOPES,
      YOUTUBE: YOUTUBE_SCOPES,
      GOOGLE_BUSINESS_PROFILE: GOOGLE_BUSINESS_SCOPES,
    } as const;
    for (const [provider, needed] of Object.entries(PUBLISH_SCOPES)) {
      const asked: readonly string[] = requested[provider as keyof typeof requested];
      expect(needed.length).toBeGreaterThan(0);
      for (const scope of needed) expect(asked).toContain(scope);
    }
  });
});
