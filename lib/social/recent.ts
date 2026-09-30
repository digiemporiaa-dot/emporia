/**
 * Shared by the adapters' `listRecentPosts` (brief §48, "fetch recent posts").
 */

/** At most this many posts from one listing: a day's check, not an archive import. */
export const RECENT_POSTS_LIMIT = 50;
/** Pages of results to follow before stopping, whatever the platform offers. */
export const RECENT_PAGES = 4;

/**
 * A platform timestamp. Meta writes `2026-09-25T10:00:00+0000`, which is not
 * ISO 8601 (the offset has no colon) and not every runtime parses; Google and
 * YouTube write proper ISO. Anything unparseable is null, and the post is
 * skipped rather than dated by guesswork.
 */
export function parsePlatformTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const iso = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A non-empty string from a platform response, or null. */
export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * A `paging.next` link, followed only when it points back at the platform's
 * own host. A response is data; it does not get to send the token elsewhere.
 */
export function sameOriginNext(next: unknown, base: string): string | null {
  if (typeof next !== "string") return null;
  try {
    return new URL(next).origin === new URL(base).origin ? next : null;
  } catch {
    return null;
  }
}
