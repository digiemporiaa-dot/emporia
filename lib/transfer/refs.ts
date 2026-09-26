import "server-only";
import { db } from "@/lib/db";

/**
 * The lookup tables an import and an export both need.
 *
 * A spreadsheet names a service by its slug and an author by their email,
 * because nobody types a cuid into Excel — and a file full of cuids cannot be
 * written by hand at all, which would make the import useless for anything but
 * re-importing an export. Loaded once per run rather than per row: a
 * five-hundred-row file would otherwise be two thousand queries.
 */

export type Refs = {
  services: ReadonlyMap<string, string>;
  cities: ReadonlyMap<string, string>;
  packages: ReadonlyMap<string, string>;
  categories: ReadonlyMap<string, string>;
  /** Staff only. A portal user is not an author. */
  authors: ReadonlyMap<string, string>;
};

const bySlug = (rows: readonly { id: string; slug: string }[]) =>
  new Map(rows.map((row) => [row.slug.toLowerCase(), row.id]));

export async function loadRefs(): Promise<Refs> {
  const [services, cities, packages, categories, authors] = await Promise.all([
    db.service.findMany({ select: { id: true, slug: true } }),
    db.city.findMany({ select: { id: true, slug: true } }),
    db.servicePackage.findMany({ select: { id: true, slug: true } }),
    db.blogCategory.findMany({ select: { id: true, slug: true } }),
    db.user.findMany({ where: { type: "STAFF" }, select: { id: true, email: true } }),
  ]);

  return {
    services: bySlug(services),
    cities: bySlug(cities),
    packages: bySlug(packages),
    categories: bySlug(categories),
    authors: new Map(
      authors
        .filter((row): row is { id: string; email: string } => row.email !== null)
        .map((row) => [row.email.toLowerCase(), row.id]),
    ),
  };
}
