import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Page CMS foundation, against the real database.
 *
 * The two behaviours worth pinning here are the ones that fail silently and
 * publicly if they regress: a soft-deleted page must stop serving, and a hidden
 * section must stop rendering. Both are enforced in the *query*, so a test that
 * mocked Prisma would prove nothing.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describeDb("page CMS foundation", () => {
  let prisma: PrismaClient;
  const slug = `test-page-${Date.now()}`;
  let pageId = "";

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const page = await prisma.page.create({
      data: {
        slug,
        title: "Test page",
        status: "PUBLISHED",
        publishedAt: new Date(),
        sections: {
          create: [
            { type: "prose", order: 0, content: { paragraphs: ["Visible"] }, isVisible: true },
            { type: "prose", order: 1, content: { paragraphs: ["Hidden"] }, isVisible: false },
          ],
        },
      },
      select: { id: true },
    });
    pageId = page.id;
  });

  afterAll(async () => {
    if (pageId) await prisma.page.delete({ where: { id: pageId } });
    await prisma.$disconnect();
  });

  it("defaults new sections to visible", async () => {
    const section = await prisma.pageSection.create({
      data: { pageId, type: "prose", order: 2, content: { paragraphs: ["Default"] } },
      select: { id: true, isVisible: true },
    });
    expect(section.isVisible).toBe(true);
    await prisma.pageSection.delete({ where: { id: section.id } });
  });

  it("serves only the visible sections of a published page", async () => {
    const page = await prisma.page.findFirst({
      where: { slug, status: "PUBLISHED", deletedAt: null },
      select: { sections: { where: { isVisible: true }, orderBy: { order: "asc" } } },
    });

    expect(page?.sections).toHaveLength(1);
    expect(page?.sections[0]?.content).toEqual({ paragraphs: ["Visible"] });
  });

  it("stops serving a page once it is soft-deleted, status notwithstanding", async () => {
    await prisma.page.update({ where: { id: pageId }, data: { deletedAt: new Date() } });

    const served = await prisma.page.findFirst({
      where: { slug, status: "PUBLISHED", deletedAt: null },
      select: { id: true },
    });
    expect(served).toBeNull();

    // The row itself survives, which is the point of a soft delete.
    const stillThere = await prisma.page.findUnique({ where: { id: pageId }, select: { id: true } });
    expect(stillThere).not.toBeNull();

    await prisma.page.update({ where: { id: pageId }, data: { deletedAt: null } });
  });

  it("keeps a page's sections when a referenced reusable section is deleted", async () => {
    const reusable = await prisma.reusableSection.create({
      data: {
        key: `test-reusable-${Date.now()}`,
        name: "Test reusable",
        type: "cta",
        content: { heading: "Talk to us", ctaLabel: "Contact", ctaHref: "/contact" },
      },
      select: { id: true },
    });

    const section = await prisma.pageSection.create({
      data: {
        pageId,
        type: "cta",
        order: 3,
        content: { heading: "Talk to us", ctaLabel: "Contact", ctaHref: "/contact" },
        reusableSectionId: reusable.id,
      },
      select: { id: true },
    });

    await prisma.reusableSection.delete({ where: { id: reusable.id } });

    // onDelete: SetNull — the slot degrades to its snapshot rather than
    // cascading the page's section away with it.
    const after = await prisma.pageSection.findUnique({
      where: { id: section.id },
      select: { reusableSectionId: true, content: true },
    });
    expect(after?.reusableSectionId).toBeNull();
    expect(after?.content).toMatchObject({ heading: "Talk to us" });

    await prisma.pageSection.delete({ where: { id: section.id } });
  });
});
