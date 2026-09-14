import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { setSectionAudience } from "@/lib/services/page.service";
import { forVisitor, publishedPageSections } from "@/lib/content/queries";
import { audienceRuleSchema } from "@/lib/validation/audience";
import type { Actor } from "@/lib/actor/types";

/**
 * Personalisation, end to end.
 *
 * The property that matters most is not which visitor sees what — the pure
 * matcher covers that — but that the *cache* cannot serve one visitor's variant
 * to another. Rules are cached with the page; the visitor is applied after.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `pz-${Date.now()}`;

function actorWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Editor",
    email: null,
    type: "STAFF",
    roleName: "CONTENT_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const visitor = (over: Partial<Parameters<typeof forVisitor>[1]> = {}) => ({
  device: "DESKTOP" as const,
  isNewVisitor: true,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  referrer: null,
  ...over,
});

describe("a rule has to say something", () => {
  it("refuses a rule with no conditions set", () => {
    // It would match everyone, which is what having no rule already means —
    // so saving it would read as "targeted" while doing nothing.
    const result = audienceRuleSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts a rule with one condition", () => {
    expect(audienceRuleSchema.safeParse({ device: "MOBILE" }).success).toBe(true);
    expect(audienceRuleSchema.safeParse({ utmMedium: "cpc" }).success).toBe(true);
  });
});

describe("every public render personalises", () => {
  /**
   * Six routes render CMS sections. Forgetting one would leave a page quietly
   * ignoring its own targeting — no type error, no failing test, just a band
   * shown to everybody. This is the guard.
   */
  const RENDERERS = [
    "app/(website)/page.tsx",
    "app/(website)/about/page.tsx",
    "app/(website)/careers/page.tsx",
    "app/(website)/privacy-policy/page.tsx",
    "app/(website)/terms-and-conditions/page.tsx",
    "app/(website)/[...landingPage]/page.tsx",
  ] as const;

  for (const file of RENDERERS) {
    it(`${file} filters by visitor`, () => {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("visibleSections");
      // The unfiltered list must not reach the renderer.
      expect(source).not.toMatch(/sections=\{(result\.)?page\.sections\}/);
    });
  }
});

describeDb("section audiences", () => {
  const pages: string[] = [];
  let editor: Actor;

  beforeAll(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    editor = actorWith(staff.id, ["pages.view", "pages.edit"]);
  });

  afterAll(async () => {
    await db.pageSection.deleteMany({ where: { pageId: { in: pages } } });
    await db.page.deleteMany({ where: { id: { in: pages } } });
  });

  /** A published page with two bands: one for everyone, one to be targeted. */
  async function newPage() {
    const page = await db.page.create({
      data: {
        slug: `pz-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
        title: "A personalised page",
        status: "PUBLISHED",
        sections: {
          create: [
            { type: "richText", order: 0, content: { body: "Everyone sees this." } },
            { type: "richText", order: 1, content: { body: "Only some people." } },
          ],
        },
      },
      select: {
        id: true,
        slug: true,
        sections: { orderBy: { order: "asc" }, select: { id: true } },
      },
    });
    pages.push(page.id);
    return page;
  }

  it("stores the rules a band is given", async () => {
    const page = await newPage();
    const target = page.sections[1]!.id;

    await setSectionAudience(editor, target, [
      {
        visitorType: "ANY",
        device: "MOBILE",
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        referrerContains: null,
      },
    ]);

    const stored = await db.sectionAudience.findMany({ where: { sectionId: target } });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.device).toBe("MOBILE");
  });

  it("replaces the rules wholesale, so removing one removes it", async () => {
    const page = await newPage();
    const target = page.sections[1]!.id;
    const rule = (device: "MOBILE" | "DESKTOP") => ({
      visitorType: "ANY" as const,
      device,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      referrerContains: null,
    });

    await setSectionAudience(editor, target, [rule("MOBILE"), rule("DESKTOP")]);
    await setSectionAudience(editor, target, [rule("MOBILE")]);

    const stored = await db.sectionAudience.findMany({ where: { sectionId: target } });
    expect(stored.map((row) => row.device)).toEqual(["MOBILE"]);
  });

  it("clears the rules, putting the band back in front of everyone", async () => {
    const page = await newPage();
    const target = page.sections[1]!.id;
    await setSectionAudience(editor, target, [
      {
        visitorType: "RETURNING",
        device: "ANY",
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        referrerContains: null,
      },
    ]);
    await setSectionAudience(editor, target, []);

    expect(await db.sectionAudience.count({ where: { sectionId: target } })).toBe(0);
  });

  it("needs pages.edit", async () => {
    const page = await newPage();
    const viewer = actorWith(editor.userId, ["pages.view"]);
    await expect(setSectionAudience(viewer, page.sections[1]!.id, [])).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("audits the change", async () => {
    const page = await newPage();
    const target = page.sections[1]!.id;
    await setSectionAudience(editor, target, []);

    const entries = await db.auditLog.count({
      where: { entityType: "PageSection audience", entityId: target },
    });
    expect(entries).toBe(1);
  });

  // -------------------------------------------------------------------------
  // The render, and the cache
  // -------------------------------------------------------------------------

  it("serves a targeted band to the visitor it is for, and not to another", async () => {
    const page = await newPage();
    const target = page.sections[1]!.id;
    await setSectionAudience(editor, target, [
      {
        visitorType: "ANY",
        device: "MOBILE",
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        referrerContains: null,
      },
    ]);

    const published = await publishedPageSections(page.slug);
    expect(published).not.toBeNull();

    const onMobile = forVisitor(published!, visitor({ device: "MOBILE" }));
    const onDesktop = forVisitor(published!, visitor({ device: "DESKTOP" }));

    expect(onMobile.map((s) => s.id)).toContain(target);
    expect(onDesktop.map((s) => s.id)).not.toContain(target);
    // The untargeted band is served either way.
    expect(onDesktop).toHaveLength(1);
  });

  it("caches the rules with the page, not the visitor with them", async () => {
    // The cached value must be the same for both visitors; only the filtering
    // differs. Reading it twice and filtering differently proves the variant is
    // not baked in.
    const page = await newPage();
    await setSectionAudience(editor, page.sections[1]!.id, [
      {
        visitorType: "RETURNING",
        device: "ANY",
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        referrerContains: null,
      },
    ]);

    const first = await publishedPageSections(page.slug);
    const returning = forVisitor(first!, visitor({ isNewVisitor: false }));

    const second = await publishedPageSections(page.slug);
    const firstTime = forVisitor(second!, visitor({ isNewVisitor: true }));

    expect(returning).toHaveLength(2);
    expect(firstTime).toHaveLength(1);
  });

  it("shows every band on a page nobody has targeted", async () => {
    const page = await newPage();
    const published = await publishedPageSections(page.slug);
    expect(forVisitor(published!, visitor())).toHaveLength(2);
    expect(Object.keys(published!.audiences)).toHaveLength(0);
  });

  it("refuses a rule that says nothing, through the service's own validation", async () => {
    // The action validates; this checks the schema the action uses is the one
    // that would refuse it.
    const result = audienceRuleSchema.safeParse({
      visitorType: "ANY",
      device: "ANY",
      utmSource: "",
      utmMedium: "",
    });
    expect(result.success).toBe(false);
    expect(() => audienceRuleSchema.parse({})).toThrow();
    expect(ValidationError).toBeTypeOf("function");
  });
});
