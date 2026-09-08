import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as pageService from "@/lib/services/page.service";
import * as reusable from "@/lib/services/reusable-section.service";
import { ConflictError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";

/**
 * Reusable sections, against the real database.
 *
 * The behaviours worth pinning are the ones that touch pages nobody is looking
 * at: a save propagating, an unpublished save *not* propagating, and a delete
 * leaving every placement rendering.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const CTA = { heading: "Ready to talk?", ctaLabel: "Contact", ctaHref: "/contact", tone: "navy" };

describeDb("reusable sections", () => {
  let actor: Actor;
  const pages: string[] = [];
  const bands: string[] = [];

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    actor = {
      userId: user.id,
      name: "Editor",
      email: null,
      type: "STAFF",
      roleName: "CONTENT_MANAGER",
      roleId: null,
      clientId: null,
      permissions: new Set([
        "pages.view",
        "pages.create",
        "pages.edit",
        "pages.delete",
        "pages.publish",
      ]),
      ip: null,
      userAgent: "vitest",
    };
  });

  afterAll(async () => {
    if (pages.length) await db.page.deleteMany({ where: { id: { in: pages } } });
    if (bands.length) await db.reusableSection.deleteMany({ where: { id: { in: bands } } });
  });

  async function band(name: string, publish = true) {
    const created = await reusable.createReusableSection(actor, { name, type: "cta", isGlobal: false });
    bands.push(created.id);
    if (publish) {
      await reusable.updateReusableSection(actor, created.id, {
        name,
        status: "PUBLISHED",
        isGlobal: false,
        content: CTA,
      });
    }
    return created;
  }

  async function page(title: string) {
    const created = await pageService.createPage(actor, { title });
    pages.push(created.id);
    return created;
  }

  it("derives a unique key from the name", async () => {
    const a = await band("Standard closing band");
    const b = await band("Standard closing band");
    expect(a.key).toBe("standard-closing-band");
    expect(b.key).toBe("standard-closing-band-2");
  });

  it("refuses to place an unpublished section on a page", async () => {
    const draft = await band("Unpublished band", false);
    const target = await page("Placement target");

    await expect(reusable.insertReusableSection(actor, target.id, draft.id)).rejects.toThrow(
      ConflictError,
    );
  });

  it("places a published section and renders it from the snapshot", async () => {
    const shared = await band("Placed band");
    const target = await page("Has a placement");

    await reusable.insertReusableSection(actor, target.id, shared.id);

    const full = await pageService.getPage(actor, target.id);
    expect(full.sections).toHaveLength(1);
    expect(full.sections[0]?.reusableSectionId).toBe(shared.id);
    // The content is on the PageSection, so the public query needs no join.
    expect(full.sections[0]?.content).toMatchObject({ heading: "Ready to talk?" });
  });

  it("pushes a published save to every placement at once", async () => {
    const shared = await band("Propagating band");
    const one = await page("Propagation one");
    const two = await page("Propagation two");
    await reusable.insertReusableSection(actor, one.id, shared.id);
    await reusable.insertReusableSection(actor, two.id, shared.id);

    await reusable.updateReusableSection(actor, shared.id, {
      name: "Propagating band",
      status: "PUBLISHED",
      isGlobal: false,
      content: { ...CTA, heading: "New heading everywhere" },
    });

    for (const target of [one, two]) {
      const full = await pageService.getPage(actor, target.id);
      expect(full.sections[0]?.content).toMatchObject({ heading: "New heading everywhere" });
    }
  });

  it("does not push work in progress: an unpublished save leaves placements alone", async () => {
    const shared = await band("Draft-save band");
    const target = await page("Draft-save target");
    await reusable.insertReusableSection(actor, target.id, shared.id);

    await reusable.updateReusableSection(actor, shared.id, {
      name: "Draft-save band",
      status: "DRAFT",
      isGlobal: false,
      content: { ...CTA, heading: "Not ready yet" },
    });

    const full = await pageService.getPage(actor, target.id);
    expect(full.sections[0]?.content).toMatchObject({ heading: "Ready to talk?" });
  });

  it("detaches placements on delete rather than blanking the pages", async () => {
    const shared = await band("Deleted band");
    const target = await page("Survives the delete");
    await reusable.insertReusableSection(actor, target.id, shared.id);

    const result = await reusable.deleteReusableSection(actor, shared.id);
    expect(result.detached).toBe(1);

    const full = await pageService.getPage(actor, target.id);
    expect(full.sections).toHaveLength(1);
    expect(full.sections[0]?.reusableSectionId).toBeNull();
    // The band is still there, still rendering, now independent.
    expect(full.sections[0]?.content).toMatchObject({ heading: "Ready to talk?" });
  });

  it("unlinks one placement without affecting the others", async () => {
    const shared = await band("Partly detached band");
    const kept = await page("Stays linked");
    const freed = await page("Gets unlinked");
    await reusable.insertReusableSection(actor, kept.id, shared.id);
    await reusable.insertReusableSection(actor, freed.id, shared.id);

    const freedPage = await pageService.getPage(actor, freed.id);
    await reusable.detachSection(actor, freedPage.sections[0]!.id);

    await reusable.updateReusableSection(actor, shared.id, {
      name: "Partly detached band",
      status: "PUBLISHED",
      isGlobal: false,
      content: { ...CTA, heading: "Only the linked one changes" },
    });

    const keptAfter = await pageService.getPage(actor, kept.id);
    const freedAfter = await pageService.getPage(actor, freed.id);
    expect(keptAfter.sections[0]?.content).toMatchObject({ heading: "Only the linked one changes" });
    expect(freedAfter.sections[0]?.content).toMatchObject({ heading: "Ready to talk?" });
  });

  it("counts and lists where a section is placed", async () => {
    const shared = await band("Counted band");
    const one = await page("Counted one");
    const two = await page("Counted two");
    await reusable.insertReusableSection(actor, one.id, shared.id);
    await reusable.insertReusableSection(actor, two.id, shared.id);

    const listed = await reusable.listReusableSections(actor, { page: 1, perPage: 50 });
    const row = listed.rows.find((r) => r.id === shared.id);
    expect(row?._count.usages).toBe(2);

    const usages = await reusable.listUsages(actor, shared.id);
    expect(usages.map((u) => u.page.id).sort()).toEqual([one.id, two.id].sort());
  });

  it("excludes deleted pages from the usage list", async () => {
    const shared = await band("Usage after delete");
    const target = await page("Deleted usage page");
    await reusable.insertReusableSection(actor, target.id, shared.id);
    await pageService.deletePage(actor, target.id);

    expect(await reusable.listUsages(actor, shared.id)).toHaveLength(0);
  });

  it("offers only published sections for placement, globals first", async () => {
    await band("Zebra global band");
    const globalBand = bands[bands.length - 1]!;
    await reusable.updateReusableSection(actor, globalBand, {
      name: "Zebra global band",
      status: "PUBLISHED",
      isGlobal: true,
      content: CTA,
    });
    await band("Unpublished for insert list", false);

    const insertable = await reusable.listInsertable(actor);
    expect(insertable.some((s) => s.name === "Unpublished for insert list")).toBe(false);
    expect(insertable[0]?.isGlobal).toBe(true);
  });
});
