import "server-only";
import { env } from "@/lib/config/env";

/**
 * Canonical URL construction.
 *
 * A canonical is always derived from the public URL of the page, so it is
 * correct by default and cannot silently drift; an admin override on the `Seo`
 * record is the only way to change it (CLAUDE.md 9).
 */

/** Origin with no trailing slash, e.g. https://emporia.example */
export function siteOrigin(): string {
  return env().SITE_URL.replace(/\/+$/, "");
}

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  // Collapse a trailing slash so "/" and "/about/" never produce two canonicals.
  const normalised = clean.length > 1 ? clean.replace(/\/+$/, "") : "/";
  return `${siteOrigin()}${normalised}`;
}

/**
 * Resolve an admin-supplied canonical.
 *
 * A relative override is made absolute against the site origin; an absolute
 * one is used as given. Anything unparseable falls back to the derived URL
 * rather than emitting a broken canonical.
 */
export function resolveCanonical(path: string, override: string | null | undefined): string {
  if (!override) return absoluteUrl(path);

  const trimmed = override.trim();
  if (!trimmed) return absoluteUrl(path);
  if (trimmed.startsWith("/")) return absoluteUrl(trimmed);

  try {
    return new URL(trimmed).toString().replace(/\/+$/, "") || absoluteUrl(path);
  } catch {
    return absoluteUrl(path);
  }
}
