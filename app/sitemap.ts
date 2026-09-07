import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { absoluteUrl } from "@/lib/seo/urls";

/**
 * Dynamic sitemap.
 *
 * Every entry comes from a query for PUBLISHED records. `/admin`, `/portal`,
 * `/auth` and `/api` are excluded **by construction** rather than by a
 * disallow list — they are simply never queried, so a future route under those
 * prefixes cannot leak in by being forgotten (CLAUDE.md 9).
 *
 * Drafts are excluded for the same reason: the status filter is in the query,
 * not applied afterwards.
 */

export const dynamic = "force-dynamic";
export const revalidate = 3600;

/** Static public routes. Anything not listed here is not in the sitemap. */
const STATIC_ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/services", priority: 0.9, changeFrequency: "weekly" },
  { path: "/packages", priority: 0.9, changeFrequency: "monthly" },
  { path: "/case-studies", priority: 0.8, changeFrequency: "weekly" },
  { path: "/cities", priority: 0.7, changeFrequency: "monthly" },
  { path: "/blog", priority: 0.8, changeFrequency: "weekly" },
  { path: "/about", priority: 0.6, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.7, changeFrequency: "monthly" },
  { path: "/careers", priority: 0.4, changeFrequency: "monthly" },
  { path: "/privacy-policy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/terms-and-conditions", priority: 0.2, changeFrequency: "yearly" },
];

/** CMS pages that already have a dedicated route above. */
const ROUTED_PAGE_SLUGS = new Set([
  "home",
  "about",
  "careers",
  "privacy-policy",
  "terms-and-conditions",
]);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [services, packages, caseStudies, posts, categories, landingPages, cities, localPages] = await Promise.all([
    db.service.findMany({
      where: { status: "PUBLISHED", OR: [{ seo: null }, { seo: { robotsIndex: true } }] },
      select: { slug: true, updatedAt: true },
    }),
    db.servicePackage.findMany({
      where: { status: "PUBLISHED", OR: [{ seo: null }, { seo: { robotsIndex: true } }] },
      select: { slug: true, updatedAt: true },
    }),
    db.caseStudy.findMany({
      where: { status: "PUBLISHED", OR: [{ seo: null }, { seo: { robotsIndex: true } }] },
      select: { slug: true, updatedAt: true },
    }),
    db.blogPost.findMany({
      where: { status: "PUBLISHED", OR: [{ seo: null }, { seo: { robotsIndex: true } }] },
      select: { slug: true, updatedAt: true, publishedAt: true },
    }),
    db.blogCategory.findMany({
      where: { posts: { some: { status: "PUBLISHED" } } },
      select: { slug: true, updatedAt: true },
    }),
    db.page.findMany({
      where: {
        status: "PUBLISHED",
        deletedAt: null,
        OR: [{ seo: null }, { seo: { robotsIndex: true } }],
      },
      select: { slug: true, updatedAt: true },
    }),
    // A city is only listed once it has a published local page behind it —
    // an empty city page would be exactly the thin content CLAUDE.md 9 bans.
    db.city.findMany({
      where: { isActive: true, servicePages: { some: { status: "PUBLISHED" } } },
      select: { slug: true, updatedAt: true },
    }),
    // Service x City pages. Only PUBLISHED, which publishPage() gates on
    // canPublish(), so a thin local page cannot reach the sitemap.
    db.serviceCityPage.findMany({
      where: {
        status: "PUBLISHED",
        service: { status: "PUBLISHED" },
        city: { isActive: true },
        OR: [{ seo: null }, { seo: { robotsIndex: true } }],
      },
      select: {
        updatedAt: true,
        service: { select: { slug: true } },
        city: { select: { slug: true } },
      },
    }),
  ]);

  const now = new Date();

  const entries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified: now,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  for (const service of services) {
    entries.push({
      url: absoluteUrl(`/services/${service.slug}`),
      lastModified: service.updatedAt,
      changeFrequency: "monthly",
      priority: 0.8,
    });
  }

  for (const pkg of packages) {
    entries.push({
      url: absoluteUrl(`/packages/${pkg.slug}`),
      lastModified: pkg.updatedAt,
      changeFrequency: "monthly",
      priority: 0.7,
    });
  }

  for (const study of caseStudies) {
    entries.push({
      url: absoluteUrl(`/case-studies/${study.slug}`),
      lastModified: study.updatedAt,
      changeFrequency: "yearly",
      priority: 0.7,
    });
  }

  for (const post of posts) {
    entries.push({
      url: absoluteUrl(`/blog/${post.slug}`),
      lastModified: post.updatedAt,
      changeFrequency: "yearly",
      priority: 0.6,
    });
  }

  for (const category of categories) {
    entries.push({
      url: absoluteUrl(`/blog/category/${category.slug}`),
      lastModified: category.updatedAt,
      changeFrequency: "weekly",
      priority: 0.5,
    });
  }

  for (const city of cities) {
    entries.push({
      url: absoluteUrl(`/cities/${city.slug}`),
      lastModified: city.updatedAt,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  for (const local of localPages) {
    entries.push({
      url: absoluteUrl(`/services/${local.service.slug}/${local.city.slug}`),
      lastModified: local.updatedAt,
      changeFrequency: "monthly",
      priority: 0.7,
    });
  }

  // CMS landing pages that are not already covered by a dedicated route.
  for (const page of landingPages) {
    if (ROUTED_PAGE_SLUGS.has(page.slug)) continue;
    entries.push({
      url: absoluteUrl(`/${page.slug}`),
      lastModified: page.updatedAt,
      changeFrequency: "monthly",
      priority: 0.5,
    });
  }

  return entries;
}
