/**
 * Organic search → leads and revenue (Phase 9). Pure.
 *
 * Two questions answered here: whether a visit came from organic search, and
 * which organic landing pages draw traffic that rarely converts. Everything
 * else is joins in the service.
 */

/** A landing path two sources can agree on: leading slash, no query or fragment, no trailing slash (but "/"). */
export function pathKey(path: string): string {
  const trimmed = path.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutQuery = withSlash.split(/[?#]/)[0] ?? withSlash;
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") || "/" : "/";
}

/** The path of a full URL (Search Console reports pages as URLs), as a `pathKey`. */
export function urlPathKey(url: string): string | null {
  try {
    return pathKey(new URL(url).pathname);
  } catch {
    return null;
  }
}

/**
 * Search engines whose referrer marks an organic visit. Hosts are matched as
 * whole labels: `google.co.in` and `www.google.com` count, `notgoogle.com`
 * does not.
 */
const SEARCH_ENGINES: readonly RegExp[] = [
  /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/,
  /(^|\.)bing\.com$/,
  /(^|\.)duckduckgo\.com$/,
  /(^|\.)search\.yahoo\.com$/,
  /(^|\.)yandex\.[a-z]{2,3}$/,
  /(^|\.)baidu\.com$/,
  /(^|\.)ecosia\.org$/,
  /(^|\.)search\.brave\.com$/,
  /(^|\.)naver\.com$/,
];

export function isSearchEngine(referrer: string | null | undefined): boolean {
  if (!referrer) return false;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return SEARCH_ENGINES.some((pattern) => pattern.test(host));
  } catch {
    return false;
  }
}

export type Touch = { source: string | null; medium: string | null; referrer: string | null };

/**
 * Organic when tagged `utm_medium=organic`, or untagged and referred by a
 * search engine. Any other UTM tag wins over the referrer: a tagged ad that
 * happens to pass through Google is paid, not organic. No touch recorded
 * means unknown, which is not organic.
 */
export function isOrganicTouch(touch: Touch | null | undefined): boolean {
  if (!touch) return false;
  const medium = touch.medium?.trim().toLowerCase() ?? "";
  if (medium === "organic") return true;
  if (medium || touch.source?.trim()) return false;
  return isSearchEngine(touch.referrer);
}

export type LandingStat = { path: string; sessions: number; keyEvents: number };

export type LowConversion = LandingStat & { rate: number; siteRate: number };

/**
 * Organic landing pages with at least `minSessions` sessions whose key-event
 * rate is under `rateShare` of the site's organic rate. A site with no key
 * events at all has nothing to compare against, so nothing is flagged.
 */
export function lowConversionPages(pages: readonly LandingStat[], siteRate: number, options: { minSessions: number; rateShare: number }): LowConversion[] {
  if (!(siteRate > 0)) return [];
  return pages
    .filter((page) => page.sessions >= options.minSessions && page.keyEvents / page.sessions < siteRate * options.rateShare)
    .map((page) => ({ ...page, rate: page.keyEvents / page.sessions, siteRate }))
    .sort((a, b) => b.sessions - a.sessions || a.path.localeCompare(b.path));
}

/** A rate, or null when there is nothing to divide by. */
export const rate = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);
