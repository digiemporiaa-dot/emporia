import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { toMoneyString } from "@/lib/money";
import { resolveSectionImages, type ResolvedImage, type SectionImages } from "@/lib/content/media";
import { parseSections, type ParsedSection } from "@/lib/content/sections";
import { seoSelect, type EntitySeo } from "@/lib/seo/select";
import { resolveCollections } from "@/lib/content/collections";

/**
 * Shared read queries for the public website.
 *
 * Two things are deliberate here.
 *
 * **Caching, not prerendering.** A static route that reads the database gets
 * prerendered at build time, which would force the container build to have
 * database credentials and break the hermetic build (docs/ARCHITECTURE.md 17.2).
 * So the website's index routes render at request time and the *data* is cached
 * instead, with tags so publishing content can bust it immediately rather than
 * waiting out a TTL. Dynamic routes keep ordinary ISR.
 *
 * **Serializable returns.** The cache serializes what these return, so nothing
 * here may hand back a Prisma `Decimal` — it would come back as its internal
 * representation. Money is converted to a fixed 2dp string at this boundary,
 * which is the rule for crossing into a client component anyway
 * (docs/ARCHITECTURE.md 4.1). Dates become ISO strings for the same reason.
 */

export const CACHE_TAGS = {
  services: "services",
  packages: "packages",
  caseStudies: "case-studies",
  testimonials: "testimonials",
  posts: "posts",
  pages: "pages",
} as const;

const ONE_HOUR = 3600;

export type PublishedPage = {
  title: string;
  sections: ParsedSection[];
  /** The schema type an editor opted into, gating structured data. */
  schemaType: string | null;
  /** Images referenced by the sections, resolved in one batched query. */
  images: Record<string, ResolvedImage>;
  seo: EntitySeo | null;
};

/**
 * A page plus the live business data its dynamic sections read.
 *
 * Resolved outside `publishedPageSections` on purpose. That function is cached
 * under the pages tag; the collections are cached under their own tags, so a
 * newly published service reaches the homepage without republishing the page.
 * Nesting them would have tied one cache entry to five sets of content.
 */
export async function publishedPageWithCollections(slug: string) {
  const page = await publishedPageSections(slug);
  if (!page) return null;
  const collections = await resolveCollections(page.sections);
  return { page, collections };
}

/** Sections of a published CMS page, validated and ordered. */
export const publishedPageSections = unstable_cache(
  async (slug: string): Promise<PublishedPage | null> => {
    const page = await db.page.findFirst({
      // `deletedAt: null` matters as much as the status: a soft-deleted page
      // keeps its row and its PUBLISHED history, and must stop serving anyway.
      where: { slug, status: "PUBLISHED", deletedAt: null },
      select: {
        title: true,
        seo: { select: seoSelect },
        sections: {
          // A hidden section keeps its slot in the builder and its position in
          // the order; it simply does not reach the public page.
          where: { isVisible: true },
          orderBy: { order: "asc" },
          select: { id: true, type: true, order: true, content: true },
        },
      },
    });

    if (!page) return null;

    const sections = parseSections(page.sections);
    // A Map is not serialisable through the cache boundary, so this crosses it
    // as a plain object (docs/ARCHITECTURE.md 17.2, cached values must be
    // serialisable).
    const images: SectionImages = await resolveSectionImages(sections);

    return {
      title: page.title,
      seo: page.seo,
      schemaType: page.seo?.schemaType ?? null,
      sections,
      images: Object.fromEntries(images),
    };
  },
  ["published-page"],
  { revalidate: ONE_HOUR, tags: [CACHE_TAGS.pages] },
);

export type ServiceSummary = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  icon: string | null;
};

export const publishedServices = unstable_cache(
  async (): Promise<ServiceSummary[]> =>
    db.service.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { order: "asc" },
      select: { id: true, slug: true, name: true, shortDescription: true, icon: true },
    }),
  ["published-services"],
  { revalidate: ONE_HOUR, tags: [CACHE_TAGS.services] },
);

export type PackageSummary = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  /** Fixed 2dp string, never a Decimal or a number. */
  price: string;
  currency: string;
  billingType: string;
  taxRate: string;
  isRecommended: boolean;
  service: { slug: string; name: string } | null;
  features: { label: string; detail: string | null; isIncluded: boolean }[];
};

export const publishedPackages = unstable_cache(
  async (): Promise<PackageSummary[]> => {
    const rows = await db.servicePackage.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { order: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        tagline: true,
        price: true,
        currency: true,
        billingType: true,
        taxRate: true,
        isRecommended: true,
        service: { select: { slug: true, name: true } },
        features: {
          orderBy: { order: "asc" },
          select: { label: true, detail: true, isIncluded: true },
        },
      },
    });

    return rows.map((row) => ({
      ...row,
      price: toMoneyString(row.price.toString()),
      taxRate: row.taxRate.toString(),
    }));
  },
  ["published-packages"],
  { revalidate: ONE_HOUR, tags: [CACHE_TAGS.packages] },
);

export type CaseStudySummary = {
  id: string;
  slug: string;
  title: string;
  clientName: string;
  summary: string;
  service: { slug: string; name: string } | null;
  city: { slug: string; name: string } | null;
  metrics: { label: string; value: string; unit: string | null }[];
};

export const publishedCaseStudies = unstable_cache(
  async (limit?: number): Promise<CaseStudySummary[]> =>
    db.caseStudy.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      ...(limit ? { take: limit } : {}),
      select: {
        id: true,
        slug: true,
        title: true,
        clientName: true,
        summary: true,
        service: { select: { slug: true, name: true } },
        city: { select: { slug: true, name: true } },
        metrics: { orderBy: { order: "asc" }, select: { label: true, value: true, unit: true } },
      },
    }),
  ["published-case-studies"],
  { revalidate: ONE_HOUR, tags: [CACHE_TAGS.caseStudies] },
);

export type TestimonialSummary = {
  id: string;
  authorName: string;
  authorRole: string | null;
  company: string | null;
  quote: string;
  /** Null means no rating was given, which is not the same as one star. */
  rating: number | null;
  service: { slug: string; name: string } | null;
  city: { slug: string; name: string } | null;
};

export const publishedTestimonials = unstable_cache(
  async (limit?: number): Promise<TestimonialSummary[]> =>
    db.testimonial.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { order: "asc" },
      ...(limit ? { take: limit } : {}),
      select: {
        id: true,
        authorName: true,
        authorRole: true,
        company: true,
        quote: true,
        rating: true,
        service: { select: { slug: true, name: true } },
        city: { select: { slug: true, name: true } },
      },
    }),
  ["published-testimonials"],
  { revalidate: ONE_HOUR, tags: [CACHE_TAGS.testimonials] },
);

export type PostSummary = {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  /** ISO string — a Date would not survive the cache boundary intact. */
  publishedAt: string | null;
  readingMinutes: number;
  category: { slug: string; name: string } | null;
  /** Slugs only: enough to filter a block by, and cheap to carry. */
  tags: string[];
};

export const publishedPosts = unstable_cache(
  async (limit?: number): Promise<PostSummary[]> => {
    const rows = await db.blogPost.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      ...(limit ? { take: limit } : {}),
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        publishedAt: true,
        readingMinutes: true,
        category: { select: { slug: true, name: true } },
        tags: { select: { tag: { select: { slug: true } } } },
      },
    });

    return rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      tags: row.tags.map((link) => link.tag.slug),
    }));
  },
  ["published-posts"],
  { revalidate: ONE_HOUR, tags: [CACHE_TAGS.posts] },
);

/** Site settings used by the header, footer and contact page. */
export const siteSettings = unstable_cache(
  async (keys: readonly string[]): Promise<Record<string, string>> => {
    const rows = await db.siteSetting.findMany({
      where: { key: { in: [...keys] } },
      select: { key: true, value: true },
    });

    const map: Record<string, string> = {};
    for (const row of rows) {
      if (typeof row.value === "string") map[row.key] = row.value;
    }
    return map;
  },
  ["site-settings"],
  { revalidate: ONE_HOUR, tags: [CACHE_TAGS.pages] },
);

// ---------------------------------------------------------------------------
// Local SEO
// ---------------------------------------------------------------------------

export type CitySummary = {
  id: string;
  slug: string;
  name: string;
  state: string;
  publishedPageCount: number;
};

/** Cities that are active AND have at least one publishable local page. */
export const activeCities = unstable_cache(
  async (): Promise<CitySummary[]> => {
    const rows = await db.city.findMany({
      where: { isActive: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        state: true,
        _count: { select: { servicePages: { where: { status: "PUBLISHED" } } } },
      },
    });

    return rows
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        state: row.state,
        publishedPageCount: row._count.servicePages,
      }))
      .filter((city) => city.publishedPageCount > 0);
  },
  ["active-cities"],
  { revalidate: ONE_HOUR, tags: ["cities", "service-city-pages"] },
);
