/**
 * UTM tagging for the links that go out in posts.
 *
 * Done here rather than in an adapter, and rather than being typed into the
 * link field by hand. Two reasons. Attribution has to be consistent or the
 * campaign reporting in §9 is comparing differently-labelled traffic and
 * calling it a trend; and a person typing `?utm_source=linkedin` into a form
 * will eventually type `?utm_source=Linkedin` instead, which lands as a second
 * source in every report forever.
 *
 * The rule: **we only add what is missing.** A link that already carries a
 * `utm_source` was tagged deliberately by somebody, and overwriting it would
 * silently discard their intent.
 */

import type { SocialProvider } from "@/generated/prisma/enums";

/**
 * The `utm_source` for each platform: lowercase, stable, and never derived
 * from a label that somebody might reword on a screen one day.
 */
const SOURCE: Record<SocialProvider, string> = {
  INSTAGRAM: "instagram",
  FACEBOOK: "facebook",
  LINKEDIN: "linkedin",
  YOUTUBE: "youtube",
  X: "x",
  GOOGLE_BUSINESS_PROFILE: "google_business",
};

export type UtmInput = {
  provider: SocialProvider;
  /** From the post, falling back to the campaign's name where there is one. */
  campaign: string | null;
  content: string | null;
};

/**
 * Normalise a campaign or content value into something safe to compare.
 *
 * Analytics tools treat `Diwali Sale` and `diwali-sale` as two campaigns, so
 * the value is flattened once, here, rather than hopefully at read time.
 */
export function utmValue(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

/**
 * Add the tags a link is missing.
 *
 * Returns the URL unchanged when there is nothing to add, and returns the
 * original string untouched when it cannot be parsed — a malformed link is the
 * editor's problem to see and fix, not something to mangle further on the way
 * out. `medium` is always `social`, because that is what it is.
 */
export function tagLink(url: string | null, input: UtmInput): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  // Only http(s). A `javascript:` or `data:` link has no business being
  // posted, and appending query parameters to one would be the wrong answer to
  // finding it here.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url;

  const setIfAbsent = (key: string, value: string | null) => {
    if (!value) return;
    if (parsed.searchParams.has(key)) return;
    parsed.searchParams.set(key, value);
  };

  setIfAbsent("utm_source", SOURCE[input.provider]);
  setIfAbsent("utm_medium", "social");
  setIfAbsent("utm_campaign", input.campaign ? utmValue(input.campaign) : null);
  setIfAbsent("utm_content", input.content ? utmValue(input.content) : null);

  return parsed.toString();
}

/** The `utm_source` a provider posts under. Exported for reporting to join on. */
export function utmSource(provider: SocialProvider): string {
  return SOURCE[provider];
}
