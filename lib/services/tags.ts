import "server-only";
import { slugify } from "@/lib/utils/slug";

/**
 * Resolve tag names to rows, creating any that do not exist.
 *
 * Matched on the slugified name, so "Local SEO", "local seo" and "Local  SEO"
 * are one tag rather than three.
 *
 * Written against the shape of a tag table rather than one named table, because
 * the project has two vocabularies — `BlogTag` for posts and `Tag` for
 * everything else — and typing the same reconciliation twice is how they drift
 * into disagreeing about what "Local SEO" means.
 */
export type TagDelegate = {
  findMany(args: {
    where: { slug: { in: string[] } };
    select: { id: true; slug: true };
  }): Promise<{ id: string; slug: string }[]>;
  create(args: { data: { slug: string; name: string } }): Promise<{ id: string }>;
};

export async function resolveTagIds(
  delegate: TagDelegate,
  names: readonly string[],
): Promise<string[]> {
  const wanted = new Map<string, string>();
  for (const name of names) {
    const slug = slugify(name);
    // A name that slugifies to nothing (punctuation, or a script with no Latin
    // decomposition) is not a tag anyone can link to.
    if (slug) wanted.set(slug, name.trim());
  }
  if (wanted.size === 0) return [];

  const existing = await delegate.findMany({
    where: { slug: { in: [...wanted.keys()] } },
    select: { id: true, slug: true },
  });
  const bySlug = new Map(existing.map((tag) => [tag.slug, tag.id]));

  for (const [slug, name] of wanted) {
    if (bySlug.has(slug)) continue;
    const created = await delegate.create({ data: { slug, name } });
    bySlug.set(slug, created.id);
  }

  return [...wanted.keys()].flatMap((slug) => {
    const id = bySlug.get(slug);
    return id ? [id] : [];
  });
}
