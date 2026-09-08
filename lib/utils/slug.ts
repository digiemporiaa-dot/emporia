/**
 * Slug generation and reservation.
 *
 * Pure and dependency-free, so the same rules apply in the validation layer,
 * the service layer and the public route that serves CMS pages. Slug logic
 * lives here and nowhere else (CLAUDE.md 4).
 */

/**
 * Top-level paths a CMS page may never claim.
 *
 * A single-segment CMS page is served by `app/(website)/[...landingPage]`,
 * which is the *last* route to match. So a page saved with the slug `services`
 * would be shadowed by the real `/services` route and silently never render.
 * Refusing the slug at write time is the difference between an error message
 * and an editor wondering why their page is blank.
 *
 * `home` is listed because the homepage is composed bespokely on `/` and reads
 * its sections by that slug; it is not reachable at `/home`.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  // Dedicated public routes.
  "about",
  "blog",
  "careers",
  "case-studies",
  "cities",
  "contact",
  "home",
  "packages",
  "privacy-policy",
  "services",
  "terms-and-conditions",
  // Application surfaces.
  "admin",
  "api",
  "auth",
  "portal",
  "preview",
  // Generated files. The slug pattern rejects dots, so these can only be hit
  // without their extension, but naming them costs nothing.
  "robots",
  "sitemap",
]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.trim().toLowerCase());
}

/**
 * Derive a URL slug from arbitrary text.
 *
 * Decomposes accents and drops the combining marks rather than transliterating,
 * so "Café Noir" becomes "cafe-noir". Scripts with no Latin decomposition
 * (Devanagari, for instance) reduce to nothing — the caller gets an empty
 * string and must ask for a slug rather than being handed a meaningless one.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/**
 * A slug that is not already taken, by appending `-2`, `-3` and so on.
 *
 * `isTaken` is supplied by the caller so this stays free of database access and
 * can be unit tested directly. Reserved slugs count as taken.
 */
export async function uniqueSlug(
  base: string,
  isTaken: (candidate: string) => Promise<boolean>,
  limit = 50,
): Promise<string> {
  const root = slugify(base);
  if (!root) throw new Error("Cannot derive a slug from that text.");

  for (let suffix = 1; suffix <= limit; suffix += 1) {
    const candidate = suffix === 1 ? root : `${root}-${suffix}`;
    if (isReservedSlug(candidate)) continue;
    if (!(await isTaken(candidate))) return candidate;
  }

  throw new Error(`Could not find a free slug based on "${root}".`);
}
