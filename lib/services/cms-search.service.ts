import "server-only";
import { db } from "@/lib/db";
import { can } from "@/lib/auth/rbac";
import { requireStaff } from "@/lib/auth/rbac";
import {
  CONTENT_REGISTRY,
  CONTENT_TYPES,
  type ContentHit,
  type ContentState,
  type ContentType,
} from "@/lib/cms/registry";
import type { Actor } from "@/lib/actor/types";

/**
 * Search across every content type at once.
 *
 * ## Why this queries ten tables rather than one index
 *
 * A `SearchIndex` table would be one query, and would need maintaining at every
 * write site of ten models plus the seeds. The media library made the same
 * choice for the same reason (17.1b-vii): an index that has silently drifted is
 * worse than a slower query, because a record that cannot be found is a record
 * an editor recreates. These tables hold hundreds of rows, not millions, and
 * the ten queries run in parallel.
 *
 * ## Permissions are per type, not per screen
 *
 * Each type is queried only if the actor holds its own view permission. A
 * content manager without `casestudies.view` gets results that contain no case
 * studies — not a filtered-out row, not a greyed-out row: the query is never
 * issued. Hiding a result client-side would be exactly the mistake CLAUDE.md 2
 * names.
 */

export type ContentSearchParams = {
  query?: string | undefined;
  /** Restrict to one type. Absent means every type the actor may see. */
  type?: ContentType | undefined;
  /** Restrict to one state. Absent means any. */
  state?: ContentState | undefined;
  page: number;
  perPage: number;
};

export type ContentSearchResult = {
  rows: ContentHit[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  /** How many hits each type contributed, before paging. */
  countsByType: Partial<Record<ContentType, number>>;
  /** Types the actor may search at all, for the filter. */
  available: ContentType[];
};

/** Which types this actor may see. */
export function searchableTypes(actor: Actor): ContentType[] {
  return CONTENT_TYPES.filter((type) => can(actor, CONTENT_REGISTRY[type].viewPermission));
}

/** `PublishStatus` → the shared vocabulary. They happen to agree. */
const fromStatus = (status: string): ContentState =>
  status === "PUBLISHED" ? "PUBLISHED" : status === "ARCHIVED" ? "ARCHIVED" : "DRAFT";

/** A boolean switch → the shared vocabulary. Off is a draft, never an archive. */
const fromActive = (isActive: boolean): ContentState => (isActive ? "PUBLISHED" : "DRAFT");

const contains = (query: string) => ({ contains: query, mode: "insensitive" as const });

/**
 * Every hit of one type.
 *
 * Each branch reads its own table and maps it into the shared row shape. It is
 * a long switch rather than a clever abstraction on purpose: the models differ
 * in which column is the title, whether they have a slug, and how they say
 * "published", and a generic version would have to be told all of that anyway —
 * in a second place, which is the thing the registry exists to prevent.
 */
async function hitsFor(
  type: ContentType,
  query: string | undefined,
  state: ContentState | undefined,
): Promise<ContentHit[]> {
  const meta = CONTENT_REGISTRY[type];
  const href = meta.href;

  // A state this type cannot be in matches nothing, rather than everything.
  if (state && !meta.states.includes(state)) return [];

  const statusWhere = state ? { status: state } : {};
  const activeWhere =
    state === undefined ? {} : { isActive: state === "PUBLISHED" };

  switch (type) {
    case "page": {
      const rows = await db.page.findMany({
        where: {
          deletedAt: null,
          ...statusWhere,
          ...(query
            ? { OR: [{ title: contains(query) }, { slug: contains(query) }, { internalName: contains(query) }] }
            : {}),
        },
        select: { id: true, title: true, slug: true, status: true, updatedAt: true },
      });
      return rows.map((row) => ({
        type,
        id: row.id,
        title: row.title,
        slug: `/${row.slug}`,
        state: fromStatus(row.status),
        updatedAt: row.updatedAt.toISOString(),
        href: href(row.id),
      }));
    }

    case "reusableSection": {
      const rows = await db.reusableSection.findMany({
        where: {
          deletedAt: null,
          ...statusWhere,
          ...(query ? { OR: [{ name: contains(query) }, { key: contains(query) }] } : {}),
        },
        select: { id: true, name: true, key: true, status: true, updatedAt: true },
      });
      return rows.map((row) => ({
        type,
        id: row.id,
        title: row.name,
        slug: row.key,
        state: fromStatus(row.status),
        updatedAt: row.updatedAt.toISOString(),
        href: href(row.id),
      }));
    }

    case "blogPost": {
      const rows = await db.blogPost.findMany({
        where: {
          ...statusWhere,
          ...(query
            ? { OR: [{ title: contains(query) }, { slug: contains(query) }, { excerpt: contains(query) }] }
            : {}),
        },
        select: { id: true, title: true, slug: true, status: true, updatedAt: true },
      });
      return rows.map((row) => ({
        type,
        id: row.id,
        title: row.title,
        slug: `/blog/${row.slug}`,
        state: fromStatus(row.status),
        updatedAt: row.updatedAt.toISOString(),
        href: href(row.id),
      }));
    }

    case "caseStudy": {
      const rows = await db.caseStudy.findMany({
        where: {
          ...statusWhere,
          ...(query ? { OR: [{ title: contains(query) }, { slug: contains(query) }] } : {}),
        },
        select: { id: true, title: true, slug: true, status: true, updatedAt: true },
      });
      return rows.map((row) => ({
        type,
        id: row.id,
        title: row.title,
        slug: `/case-studies/${row.slug}`,
        state: fromStatus(row.status),
        updatedAt: row.updatedAt.toISOString(),
        href: href(row.id),
      }));
    }

    case "testimonial": {
      const rows = await db.testimonial.findMany({
        where: {
          ...statusWhere,
          ...(query
            ? { OR: [{ authorName: contains(query) }, { quote: contains(query) }] }
            : {}),
        },
        select: { id: true, authorName: true, status: true, updatedAt: true },
      });
      return rows.map((row) => ({
        type,
        id: row.id,
        title: row.authorName,
        slug: null,
        state: fromStatus(row.status),
        updatedAt: row.updatedAt.toISOString(),
        href: href(row.id),
      }));
    }

    case "faq": {
      const rows = await db.fAQ.findMany({
        where: {
          ...activeWhere,
          ...(query ? { OR: [{ question: contains(query) }, { answer: contains(query) }] } : {}),
        },
        select: { id: true, question: true, isActive: true, updatedAt: true },
      });
      return rows.map((row) => ({
        type,
        id: row.id,
        title: row.question,
        slug: null,
        state: fromActive(row.isActive),
        updatedAt: row.updatedAt.toISOString(),
        href: href(row.id),
      }));
    }

    case "service": {
      const rows = await db.service.findMany({
        where: {
          ...statusWhere,
          ...(query
            ? { OR: [{ name: contains(query) }, { slug: contains(query) }, { shortDescription: contains(query) }] }
            : {}),
        },
        select: { id: true, name: true, slug: true, status: true, updatedAt: true },
      });
      return rows.map((row) => ({
        type,
        id: row.id,
        title: row.name,
        slug: `/services/${row.slug}`,
        state: fromStatus(row.status),
        updatedAt: row.updatedAt.toISOString(),
        href: href(row.id),
      }));
    }

    case "city": {
      const rows = await db.city.findMany({
        where: {
          ...activeWhere,
          ...(query ? { OR: [{ name: contains(query) }, { slug: contains(query) }] } : {}),
        },
        select: { id: true, name: true, slug: true, isActive: true, updatedAt: true },
      });
      return rows.map((row) => ({
        type,
        id: row.id,
        title: row.name,
        slug: `/cities/${row.slug}`,
        state: fromActive(row.isActive),
        updatedAt: row.updatedAt.toISOString(),
        href: href(row.id),
      }));
    }

    case "servicePackage": {
      const rows = await db.servicePackage.findMany({
        where: {
          ...statusWhere,
          ...(query ? { OR: [{ name: contains(query) }, { slug: contains(query) }] } : {}),
        },
        select: { id: true, name: true, slug: true, status: true, updatedAt: true },
      });
      return rows.map((row) => ({
        type,
        id: row.id,
        title: row.name,
        slug: `/packages/${row.slug}`,
        state: fromStatus(row.status),
        updatedAt: row.updatedAt.toISOString(),
        href: href(row.id),
      }));
    }

    case "serviceCityPage": {
      const rows = await db.serviceCityPage.findMany({
        where: {
          ...statusWhere,
          ...(query
            ? {
                OR: [
                  { service: { name: contains(query) } },
                  { city: { name: contains(query) } },
                  { localIntro: contains(query) },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          status: true,
          updatedAt: true,
          service: { select: { name: true, slug: true } },
          city: { select: { name: true, slug: true } },
        },
      });
      return rows.map((row) => ({
        type,
        id: row.id,
        title: `${row.service.name} in ${row.city.name}`,
        slug: `/services/${row.service.slug}/${row.city.slug}`,
        state: fromStatus(row.status),
        updatedAt: row.updatedAt.toISOString(),
        href: href(row.id),
      }));
    }
  }
}

export async function searchContent(
  actor: Actor,
  params: ContentSearchParams,
): Promise<ContentSearchResult> {
  requireStaff(actor);

  const available = searchableTypes(actor);
  // A type filter the actor cannot see returns nothing rather than everything;
  // silently widening a narrowed search is how a permission check leaks.
  const types = params.type ? available.filter((type) => type === params.type) : available;

  const query = params.query?.trim() || undefined;
  const page = Math.max(1, params.page);
  const perPage = Math.min(100, Math.max(10, params.perPage));

  const groups = await Promise.all(
    types.map((type) => hitsFor(type, query, params.state)),
  );

  const countsByType: Partial<Record<ContentType, number>> = {};
  types.forEach((type, index) => {
    const found = groups[index]?.length ?? 0;
    if (found > 0) countsByType[type] = found;
  });

  // Merged and sorted here rather than in ten queries, because "most recently
  // touched" is only meaningful across the whole result.
  const all = groups.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const total = all.length;

  return {
    rows: all.slice((page - 1) * perPage, page * perPage),
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
    countsByType,
    available,
  };
}
