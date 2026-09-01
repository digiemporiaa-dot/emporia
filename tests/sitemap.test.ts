import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * The sitemap's guarantee is about what it does NOT contain.
 *
 * These assert the queries that back it: published-and-indexable only, and no
 * private prefix can appear because none is ever queried (CLAUDE.md 9).
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describeDb("sitemap source queries", () => {
  let prisma: PrismaClient;
  let draftServiceId: string;
  let noindexPostId: string;
  let seoId: string;
  let authorId: string;

  const publishedFilter = {
    status: "PUBLISHED" as const,
    OR: [{ seo: null }, { seo: { robotsIndex: true } }],
  };

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const author = await prisma.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true },
    });
    authorId = author.id;

    const draft = await prisma.service.create({
      data: {
        slug: "sitemap-draft-service",
        name: "Draft service",
        shortDescription: "Should never appear in the sitemap.",
        status: "DRAFT",
      },
      select: { id: true },
    });
    draftServiceId = draft.id;

    const seo = await prisma.seo.create({ data: { robotsIndex: false } });
    seoId = seo.id;

    const post = await prisma.blogPost.create({
      data: {
        slug: "sitemap-noindex-post",
        title: "Noindexed post",
        authorId,
        status: "PUBLISHED",
        publishedAt: new Date(),
        seoId: seo.id,
      },
      select: { id: true },
    });
    noindexPostId = post.id;
  });

  afterAll(async () => {
    await prisma.blogPost.deleteMany({ where: { id: noindexPostId } });
    await prisma.service.deleteMany({ where: { id: draftServiceId } });
    await prisma.seo.deleteMany({ where: { id: seoId } });
    await prisma.$disconnect();
  });

  it("excludes a DRAFT service", async () => {
    const rows = await prisma.service.findMany({
      where: publishedFilter,
      select: { slug: true },
    });
    expect(rows.map((r) => r.slug)).not.toContain("sitemap-draft-service");
  });

  it("excludes a published record whose SEO says noindex", async () => {
    const rows = await prisma.blogPost.findMany({
      where: publishedFilter,
      select: { slug: true },
    });
    expect(rows.map((r) => r.slug)).not.toContain("sitemap-noindex-post");
  });

  it("includes a published record that has no SEO record at all", async () => {
    const created = await prisma.service.create({
      data: {
        slug: "sitemap-no-seo-service",
        name: "No SEO record",
        shortDescription: "Published, and should still be listed.",
        status: "PUBLISHED",
      },
      select: { id: true },
    });

    const rows = await prisma.service.findMany({ where: publishedFilter, select: { slug: true } });
    expect(rows.map((r) => r.slug)).toContain("sitemap-no-seo-service");

    await prisma.service.delete({ where: { id: created.id } });
  });

  it("has no published entity whose slug looks like a private route", async () => {
    // Guards against a private prefix ever reaching the sitemap through content.
    const [services, pages, posts] = await Promise.all([
      prisma.service.findMany({ where: publishedFilter, select: { slug: true } }),
      prisma.page.findMany({ where: publishedFilter, select: { slug: true } }),
      prisma.blogPost.findMany({ where: publishedFilter, select: { slug: true } }),
    ]);

    const slugs = [...services, ...pages, ...posts].map((r) => r.slug);
    for (const slug of slugs) {
      expect(slug.startsWith("admin")).toBe(false);
      expect(slug.startsWith("portal")).toBe(false);
      expect(slug.startsWith("auth")).toBe(false);
      expect(slug.startsWith("api")).toBe(false);
    }
  });
});
