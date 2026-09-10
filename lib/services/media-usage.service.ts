import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { mediaIdsIn } from "@/lib/content/blocks";
import { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor/types";

/**
 * Where a file is actually used.
 *
 * The library could already count the twelve foreign keys that point at
 * `Media` — a service hero, a blog cover, an OG image. What it could not see is
 * the place most images actually live: inside `PageSection.content`, as a
 * `mediaId` in JSON. Those references have no foreign key, so before this the
 * delete guard read zero for an image on the homepage and would have let
 * someone remove it, leaving a hole in a live page.
 *
 * ## Finding a reference in JSON without a second source of truth
 *
 * `mediaIdsIn` is already the single list of every place an id can sit in a
 * block, and it stays that. What is added here is only a way to avoid loading
 * every section in the database to run it.
 *
 * The narrowing is a substring match on the raw JSON text. That works because
 * a text match is a strict **superset** of a structural one: if a section
 * references the id in any field at any depth, the id appears in its text. So
 * the filter cannot miss, and anything it over-collects — an id that happens to
 * sit in some unrelated string — is thrown out by `mediaIdsIn`, which remains
 * the only thing that decides what counts as a reference.
 *
 * That asymmetry is the whole design. A reverse index table would be exact too,
 * but it would need maintaining at a dozen write sites plus the seeds, and a
 * usage count that has silently drifted is worse than none when a delete guard
 * is standing on it.
 */

/** One page that shows the file, and how many of its bands do. */
export type PageUsage = {
  id: string;
  title: string;
  slug: string;
  status: string;
  sections: number;
};

/** One reusable band that shows the file. */
export type ReusableUsage = {
  id: string;
  key: string;
  name: string;
  status: string;
  /** How many page slots render this band — a single edit reaches all of them. */
  placements: number;
};

/** A record that points at the file through a real foreign key. */
export type EntityUsage = {
  /** Human label for the relation, e.g. "Blog cover". */
  label: string;
  count: number;
};

export type MediaUsage = {
  total: number;
  pages: PageUsage[];
  reusables: ReusableUsage[];
  entities: EntityUsage[];
};

/**
 * The twelve relations that point at a file, and what to call each on screen.
 *
 * Kept beside the count rather than derived from the relation names, because
 * "seoOgImages" is not a sentence and this list is read by people deciding
 * whether it is safe to delete something.
 */
const ENTITY_LABELS = {
  userAvatars: "Staff avatar",
  serviceHeroes: "Service hero",
  blogCovers: "Blog cover",
  caseStudyCovers: "Case study cover",
  testimonialAvatars: "Testimonial avatar",
  clientLogos: "Client logo",
  contractDocs: "Contract document",
  contentItems: "Content calendar item",
  approvalVersions: "Approval version",
  popups: "Popup",
  seoOgImages: "Social image",
  seoTwitterImages: "Twitter image",
} as const;

export const ENTITY_COUNT_SELECT = Object.fromEntries(
  Object.keys(ENTITY_LABELS).map((key) => [key, true]),
) as { [K in keyof typeof ENTITY_LABELS]: true };

/** Turn a Prisma `_count` over those relations into a labelled list. */
export function entityUsage(counts: Record<string, number>): EntityUsage[] {
  const rows: EntityUsage[] = [];
  for (const [relation, label] of Object.entries(ENTITY_LABELS)) {
    const count = counts[relation] ?? 0;
    if (count > 0) rows.push({ label, count });
  }
  return rows;
}

/**
 * Sections whose JSON mentions this id, narrowed in Postgres and confirmed in
 * Node.
 *
 * `LIKE` metacharacters are escaped rather than assumed absent: ids are cuids
 * today, and an underscore in an id would otherwise quietly match one character
 * of anything.
 */
async function sectionsMentioning(mediaId: string) {
  const pattern = `%${mediaId.replace(/([\\%_])/g, "\\$1")}%`;

  const candidates = await db.$queryRaw<
    { id: string; pageId: string; type: string; content: unknown }[]
  >(
    Prisma.sql`
      SELECT id, "pageId", type, content
      FROM "PageSection"
      WHERE content::text LIKE ${pattern} ESCAPE '\\'
    `,
  );

  return candidates.filter((row) => mediaIdsIn(row.type, row.content).includes(mediaId));
}

/** Reusable bands whose JSON mentions this id, narrowed and confirmed the same way. */
async function reusablesMentioning(mediaId: string) {
  const pattern = `%${mediaId.replace(/([\\%_])/g, "\\$1")}%`;

  const candidates = await db.$queryRaw<
    {
      id: string;
      key: string;
      name: string;
      status: string;
      type: string;
      content: unknown;
    }[]
  >(
    Prisma.sql`
      SELECT id, key, name, status::text AS status, type, content
      FROM "ReusableSection"
      WHERE "deletedAt" IS NULL AND content::text LIKE ${pattern} ESCAPE '\\'
    `,
  );

  return candidates.filter((row) => mediaIdsIn(row.type, row.content).includes(mediaId));
}

/**
 * Everything that uses this file.
 *
 * Soft-deleted pages are excluded: a file is not "in use" by something already
 * in the bin, and counting it there would make files undeletable for a reason
 * nobody can see.
 */
export async function mediaUsage(actor: Actor, mediaId: string): Promise<MediaUsage> {
  requirePermission(actor, "media.view");

  const [sections, reusables, counts] = await Promise.all([
    sectionsMentioning(mediaId),
    reusablesMentioning(mediaId),
    db.media.findFirst({
      where: { id: mediaId },
      select: { _count: { select: ENTITY_COUNT_SELECT } },
    }),
  ]);

  const byPage = new Map<string, number>();
  for (const section of sections) byPage.set(section.pageId, (byPage.get(section.pageId) ?? 0) + 1);

  const pageRows = byPage.size
    ? await db.page.findMany({
        where: { id: { in: [...byPage.keys()] }, deletedAt: null },
        select: { id: true, title: true, slug: true, status: true },
        orderBy: { title: "asc" },
      })
    : [];

  const pages: PageUsage[] = pageRows.map((page) => ({
    ...page,
    sections: byPage.get(page.id) ?? 0,
  }));

  const placements = reusables.length
    ? await db.pageSection.groupBy({
        by: ["reusableSectionId"],
        where: { reusableSectionId: { in: reusables.map((row) => row.id) } },
        _count: { _all: true },
      })
    : [];

  const placementBy = new Map(
    placements.map((row) => [row.reusableSectionId ?? "", row._count._all]),
  );

  const reusableRows: ReusableUsage[] = reusables
    .map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      status: row.status,
      placements: placementBy.get(row.id) ?? 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const entities = entityUsage((counts?._count ?? {}) as Record<string, number>);

  const total =
    pages.reduce((sum, page) => sum + page.sections, 0) +
    reusableRows.length +
    entities.reduce((sum, row) => sum + row.count, 0);

  return { total, pages, reusables: reusableRows, entities };
}

/**
 * Every media id referenced anywhere, for finding the ones referenced nowhere.
 *
 * This is the one query that genuinely has to read all the content: "what is
 * unused" cannot be answered by looking at a single file. It runs only when
 * someone asks for the unused filter, never on an ordinary library page.
 */
export async function referencedMediaIds(): Promise<Set<string>> {
  const ids = new Set<string>();

  const [sections, reusables] = await Promise.all([
    db.$queryRaw<{ type: string; content: unknown }[]>(
      Prisma.sql`
        SELECT s.type, s.content
        FROM "PageSection" s
        JOIN "Page" p ON p.id = s."pageId"
        WHERE p."deletedAt" IS NULL
      `,
    ),
    db.reusableSection.findMany({
      where: { deletedAt: null },
      select: { type: true, content: true },
    }),
  ]);

  for (const row of [...sections, ...reusables]) {
    for (const id of mediaIdsIn(row.type, row.content)) ids.add(id);
  }

  // The foreign keys, one query per relation would be twelve round trips; the
  // scalar columns are read straight off the owning tables instead.
  const [
    users,
    services,
    blogs,
    caseStudies,
    testimonials,
    clients,
    contracts,
    contentItems,
    approvals,
    popups,
    seos,
  ] = await Promise.all([
    db.user.findMany({
      where: { avatarId: { not: null } },
      select: { avatarId: true },
    }),
    db.service.findMany({
      where: { heroMediaId: { not: null } },
      select: { heroMediaId: true },
    }),
    db.blogPost.findMany({
      where: { coverId: { not: null } },
      select: { coverId: true },
    }),
    db.caseStudy.findMany({
      where: { coverId: { not: null } },
      select: { coverId: true },
    }),
    db.testimonial.findMany({
      where: { avatarId: { not: null } },
      select: { avatarId: true },
    }),
    db.client.findMany({
      where: { logoId: { not: null } },
      select: { logoId: true },
    }),
    db.contract.findMany({
      where: { documentId: { not: null } },
      select: { documentId: true },
    }),
    db.contentCalendarItem.findMany({
      where: { mediaId: { not: null } },
      select: { mediaId: true },
    }),
    db.approvalVersion.findMany({
      where: { mediaId: { not: null } },
      select: { mediaId: true },
    }),
    db.popup.findMany({
      where: { mediaId: { not: null } },
      select: { mediaId: true },
    }),
    db.seo.findMany({
      where: {
        OR: [{ ogImageId: { not: null } }, { twitterImageId: { not: null } }],
      },
      select: { ogImageId: true, twitterImageId: true },
    }),
  ]);

  const collect = (rows: Record<string, string | null>[]) => {
    for (const row of rows) {
      for (const value of Object.values(row)) if (value) ids.add(value);
    }
  };

  collect(users);
  collect(services);
  collect(blogs);
  collect(caseStudies);
  collect(testimonials);
  collect(clients);
  collect(contracts);
  collect(contentItems);
  collect(approvals);
  collect(popups);
  collect(seos);

  return ids;
}
