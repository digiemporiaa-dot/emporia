import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { toMoneyString } from "@/lib/money";
import { parseSections, type ParsedSection } from "@/lib/content/sections";

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
  seo: { metaTitle: string | null; metaDescription: string | null } | null;
};

/** Sections of a published CMS page, validated and ordered. */
export const publishedPageSections = unstable_cache(
  async (slug: string): Promise<PublishedPage | null> => {
    const page = await db.page.findFirst({
      where: { slug, status: "PUBLISHED" },
      select: {
        title: true,
        seo: { select: { metaTitle: true, metaDescription: true } },
        sections: {
          orderBy: { order: "asc" },
          select: { id: true, type: true, order: true, content: true },
        },
      },
    });

    if (!page) return null;

    return {
      title: page.title,
      seo: page.seo,
      sections: parseSections(page.sections),
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
  service: { slug: string; name: string } | null;
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
        service: { select: { slug: true, name: true } },
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
      },
    });

    return rows.map((row) => ({
      ...row,
      publishedAt: row.publishedAt?.toISOString() ?? null,
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
