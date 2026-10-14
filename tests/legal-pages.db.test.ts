import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ensureStarterPages } from "@/prisma/ensure-starter-pages";
import { readFileSync } from "node:fs";
import { DEMO_LEGAL, ensureLegalPages, LEGAL_PAGES, LEGAL_UPDATED } from "@/prisma/legal-pages";
import { STARTER_MARKER, starterSectionCount } from "@/lib/content/starter";
import { BLOCK_SCHEMAS, isBlockType } from "@/lib/content/blocks";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * The approved Privacy Policy and Terms replace the legal pages' starter
 * drafts on boot and go live — but only over untouched starter text, and only
 * once. Anything an editor has done to a page wins.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const prisma = db as unknown as PrismaClient;
const SLUGS = LEGAL_PAGES.map((page) => page.slug);

describe("legal page content, pure", () => {
  it("is built from builder blocks that validate, with no starter text", () => {
    for (const page of LEGAL_PAGES) {
      expect(starterSectionCount(page.sections)).toBe(0);
      expect(page.metaDescription.length).toBeLessThanOrEqual(160);
      expect(page.sections[0]).toMatchObject({ type: "hero", content: { heading: page.title, body: `Last updated: ${LEGAL_UPDATED}` } });
      for (const section of page.sections) {
        expect(isBlockType(section.type)).toBe(true);
        if (!isBlockType(section.type)) continue;
        const parsed = BLOCK_SCHEMAS[section.type].safeParse(section.content);
        expect(parsed.error?.issues ?? [], `${page.slug} ${section.type}`).toEqual([]);
      }
    }
  });

  it("carries the details the proprietor approved", () => {
    const all = JSON.stringify(LEGAL_PAGES);
    for (const fact of ["Nishita", "07CXOPV1073K1ZT", "110059", "ceo@digiemporia.com", "+91 88160 81808", "Contabo", "Hostinger", "courts at Delhi", "30 days", "3 months"]) {
      expect(all).toContain(fact);
    }
    expect(all).not.toContain("[date of publishing]");
  });

  it("recognises the demo seed's legal pages by what prisma/seed-demo.ts actually writes", () => {
    const seed = readFileSync("prisma/seed-demo.ts", "utf8");
    for (const demo of Object.values(DEMO_LEGAL)) {
      for (const fact of [demo.intro, demo.metaDescription, `updatedAt: "${demo.updatedAt}"`]) expect(seed).toContain(fact);
    }
  });
});

describeDb("legal pages on boot", () => {
  const drop = () => db.page.deleteMany({ where: { slug: { in: SLUGS } } });
  const read = (slug: string) =>
    db.page.findUniqueOrThrow({
      where: { slug },
      select: { id: true, status: true, workflow: true, publishedAt: true, seo: { select: { metaDescription: true } }, sections: { orderBy: { order: "asc" }, select: { id: true, type: true, content: true } } },
    });

  beforeEach(async () => {
    await drop();
    await ensureStarterPages(prisma);
  });

  afterAll(async () => {
    // Leave the database as the sync leaves it.
    await drop();
    await ensureStarterPages(prisma);
    await ensureLegalPages(prisma);
  });

  it("replaces untouched starter drafts with the policy text and publishes them, once", async () => {
    expect(await ensureLegalPages(prisma)).toBe("legal pages: published privacy-policy, terms-and-conditions.");

    for (const legal of LEGAL_PAGES) {
      const page = await read(legal.slug);
      expect(page.status).toBe("PUBLISHED");
      expect(page.workflow).toBe("APPROVED");
      expect(page.publishedAt).not.toBeNull();
      expect(page.seo?.metaDescription).toBe(legal.metaDescription);
      expect(page.sections.map((s) => s.type)).toEqual(legal.sections.map((s) => s.type));
      expect(starterSectionCount(page.sections)).toBe(0);

      const audit = await db.auditLog.findFirst({ where: { entityType: "Page", entityId: page.id, action: "PUBLISH" } });
      expect(audit?.after).toMatchObject({ status: "PUBLISHED", slug: legal.slug });
    }

    // The next boot, and any after an editor changes the text, leaves it alone.
    const privacy = await read("privacy-policy");
    await db.pageSection.update({ where: { id: privacy.sections[1]!.id }, data: { content: { body: "Edited by the team." } } });
    expect(await ensureLegalPages(prisma)).toBe("legal pages: nothing to publish.");
    const after = await read("privacy-policy");
    expect(after.sections.map((s) => s.id)).toEqual(privacy.sections.map((s) => s.id));
    expect(after.sections[1]!.content).toEqual({ body: "Edited by the team." });
  });

  it("leaves a partly written draft alone and says so", async () => {
    const terms = await read("terms-and-conditions");
    await db.pageSection.update({ where: { id: terms.sections[1]!.id }, data: { content: { heading: "Use of this site", body: "Our own words." } } });

    expect(await ensureLegalPages(prisma)).toBe(
      `legal pages: published privacy-policy; left alone (partly edited, still marked “${STARTER_MARKER}”): terms-and-conditions.`,
    );
    const after = await read("terms-and-conditions");
    expect(after.status).toBe("DRAFT");
    expect(after.sections.map((s) => s.id)).toEqual(terms.sections.map((s) => s.id));
  });

  it("replaces the demo seed's published sample policy, keeping what it replaced in the audit row", async () => {
    // What `npm run db:seed:demo` leaves behind: published, one legal block, the demo's SEO text.
    for (const slug of SLUGS) {
      const demo = DEMO_LEGAL[slug]!;
      const page = await read(slug);
      await db.pageSection.deleteMany({ where: { pageId: page.id } });
      await db.page.update({
        where: { id: page.id },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date("2026-01-15T00:00:00Z"),
          seo: { create: { metaTitle: "Sample", metaDescription: demo.metaDescription } },
          sections: { create: { type: "legal", order: 1, content: { updatedAt: demo.updatedAt, intro: demo.intro, clauses: [{ heading: "Sample", text: "Sample text." }] } } },
        },
      });
    }
    // An editor's own description on one of them stays.
    const terms = await db.page.findUniqueOrThrow({ where: { slug: "terms-and-conditions" }, select: { seoId: true } });
    await db.seo.update({ where: { id: terms.seoId! }, data: { metaDescription: "Our own description." } });

    expect(await ensureLegalPages(prisma)).toBe("legal pages: published privacy-policy, terms-and-conditions.");

    const privacy = await read("privacy-policy");
    expect(privacy.status).toBe("PUBLISHED");
    expect(privacy.publishedAt).toEqual(new Date("2026-01-15T00:00:00Z"));
    expect(privacy.sections.map((s) => s.type)).toEqual(LEGAL_PAGES[0]!.sections.map((s) => s.type));
    expect(privacy.seo?.metaDescription).toBe(LEGAL_PAGES[0]!.metaDescription);
    expect((await read("terms-and-conditions")).seo?.metaDescription).toBe("Our own description.");

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "Page", entityId: privacy.id, action: "PUBLISH" }, orderBy: { createdAt: "desc" } });
    expect(audit.before).toMatchObject({ status: "PUBLISHED", replaced: "demo", sections: [{ type: "legal", content: { intro: DEMO_LEGAL["privacy-policy"]!.intro } }] });

    expect(await ensureLegalPages(prisma)).toBe("legal pages: nothing to publish.");
  });

  it("leaves a demo page someone has rewritten, or a legal block of their own", async () => {
    const privacy = await read("privacy-policy");
    await db.pageSection.deleteMany({ where: { pageId: privacy.id } });
    const demo = DEMO_LEGAL["privacy-policy"]!;
    await db.page.update({
      where: { id: privacy.id },
      data: { status: "PUBLISHED", sections: { create: { type: "legal", order: 1, content: { updatedAt: "2026-03-01", intro: demo.intro, clauses: [] } } } },
    });
    const terms = await read("terms-and-conditions");
    await db.pageSection.deleteMany({ where: { pageId: terms.id } });
    await db.page.update({
      where: { id: terms.id },
      data: { status: "PUBLISHED", sections: { create: { type: "legal", order: 1, content: { updatedAt: "2026-01-15", intro: "Our own terms.", clauses: [] } } } },
    });

    expect(await ensureLegalPages(prisma)).toBe("legal pages: nothing to publish.");
    expect((await read("privacy-policy")).sections.map((s) => s.type)).toEqual(["legal"]);
    expect((await read("terms-and-conditions")).sections.map((s) => s.type)).toEqual(["legal"]);
  });

  it("never touches a page that was published, archived or deleted by hand", async () => {
    const privacy = await read("privacy-policy");
    const terms = await read("terms-and-conditions");
    await db.page.update({ where: { id: privacy.id }, data: { deletedAt: new Date() } });
    await db.page.update({ where: { id: terms.id }, data: { status: "ARCHIVED" } });

    expect(await ensureLegalPages(prisma)).toBe("legal pages: nothing to publish.");
    expect((await read("privacy-policy")).sections.map((s) => s.id)).toEqual(privacy.sections.map((s) => s.id));
    const archived = await read("terms-and-conditions");
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.sections.map((s) => s.id)).toEqual(terms.sections.map((s) => s.id));
  });
});
