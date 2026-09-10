import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { mediaUsage, referencedMediaIds } from "@/lib/services/media-usage.service";
import { deleteMedia, updateMedia, listMedia } from "@/lib/services/media.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Where a file is used.
 *
 * The interesting cases are the ones a foreign key cannot see: an image sitting
 * as a `mediaId` inside a page section's JSON. Before this existed the delete
 * guard read zero for those and would have let someone punch a hole in a live
 * page, so most of what follows is about the block scan being exact — it finds
 * every place `mediaIdsIn` says an id can live, and it does not count a string
 * that merely happens to contain the id.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `use-${Date.now()}`;

describeDb("media usage", () => {
  const madeMedia: string[] = [];
  const madePages: string[] = [];
  const madeReusables: string[] = [];
  let actor: Actor;

  beforeAll(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    actor = {
      userId: staff.id,
      name: "Librarian",
      email: null,
      type: "STAFF",
      roleName: "CONTENT_MANAGER",
      roleId: null,
      clientId: null,
      permissions: new Set(["media.view", "media.edit", "media.delete", "media.upload"]),
      ip: null,
      userAgent: "vitest",
    };
  });

  afterAll(async () => {
    await db.pageSection.deleteMany({ where: { pageId: { in: madePages } } });
    await db.page.deleteMany({ where: { id: { in: madePages } } });
    await db.reusableSection.deleteMany({ where: { id: { in: madeReusables } } });
    await db.media.deleteMany({ where: { id: { in: madeMedia } } });
  });

  async function newMedia(label: string) {
    const media = await db.media.create({
      data: {
        key: `test/${SUFFIX}-${label}-${Math.random().toString(36).slice(2, 8)}.png`,
        url: `https://example.test/${SUFFIX}-${label}.png`,
        filename: `${label}.png`,
        mimeType: "image/png",
        size: 1024,
        type: "IMAGE",
        uploadedById: actor.userId,
      },
      select: { id: true },
    });
    madeMedia.push(media.id);
    return media.id;
  }

  async function newPage(title: string, sections: { type: string; content: unknown }[]) {
    const page = await db.page.create({
      data: {
        slug: `usage-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        status: "PUBLISHED",
        sections: {
          create: sections.map((section, order) => ({
            type: section.type,
            order,
            content: section.content as never,
          })),
        },
      },
      select: { id: true },
    });
    madePages.push(page.id);
    return page.id;
  }

  // -------------------------------------------------------------------------
  // The block scan
  // -------------------------------------------------------------------------

  it("finds an image used directly by a band", async () => {
    const id = await newMedia("direct");
    const pageId = await newPage("Direct use", [{ type: "image", content: { mediaId: id } }]);

    const usage = await mediaUsage(actor, id);
    expect(usage.total).toBe(1);
    expect(usage.pages).toHaveLength(1);
    expect(usage.pages[0]?.id).toBe(pageId);
    expect(usage.pages[0]?.sections).toBe(1);
  });

  it("finds an image nested in a card, not only at the top level", async () => {
    const id = await newMedia("card");
    await newPage("Nested use", [
      {
        type: "imageCards",
        content: {
          items: [{ title: "One" }, { title: "Two", mediaId: id }],
        },
      },
    ]);

    const usage = await mediaUsage(actor, id);
    expect(usage.total).toBe(1);
  });

  it("finds an image used only as a card's hover state", async () => {
    const id = await newMedia("hover");
    await newPage("Hover use", [
      { type: "imageCards", content: { items: [{ title: "One", hoverMediaId: id }] } },
    ]);

    expect((await mediaUsage(actor, id)).total).toBe(1);
  });

  it("finds an image used only as a section background", async () => {
    const id = await newMedia("bg");
    await newPage("Background use", [
      { type: "heading", content: { heading: "Hi", band: { background: { mediaId: id } } } },
    ]);

    expect((await mediaUsage(actor, id)).total).toBe(1);
  });

  it("counts every band on a page, and reports the page once", async () => {
    const id = await newMedia("twice");
    await newPage("Twice", [
      { type: "image", content: { mediaId: id } },
      { type: "image", content: { mediaId: id } },
    ]);

    const usage = await mediaUsage(actor, id);
    expect(usage.pages).toHaveLength(1);
    expect(usage.pages[0]?.sections).toBe(2);
    expect(usage.total).toBe(2);
  });

  it("does not count an id that merely appears inside some other text", async () => {
    // The JSON text match is only a filter. `mediaIdsIn` decides, so an id
    // quoted in a paragraph is prose, not a reference.
    const id = await newMedia("prose");
    await newPage("Prose", [
      { type: "richText", content: { body: `The old asset id was ${id}, now retired.` } },
    ]);

    expect((await mediaUsage(actor, id)).total).toBe(0);
  });

  it("does not count a page in the bin", async () => {
    const id = await newMedia("binned");
    const pageId = await newPage("Binned", [{ type: "image", content: { mediaId: id } }]);
    await db.page.update({ where: { id: pageId }, data: { deletedAt: new Date() } });

    expect((await mediaUsage(actor, id)).pages).toHaveLength(0);
  });

  it("finds an image in a reusable band, and says how many slots show it", async () => {
    const id = await newMedia("reusable");
    const band = await db.reusableSection.create({
      data: {
        key: `usage-band-${SUFFIX}`,
        name: "A shared band",
        type: "image",
        content: { mediaId: id } as never,
        status: "PUBLISHED",
      },
      select: { id: true },
    });
    madeReusables.push(band.id);

    const pageId = await newPage("Host", [{ type: "image", content: {} }]);
    await db.pageSection.updateMany({
      where: { pageId },
      data: { reusableSectionId: band.id },
    });

    const usage = await mediaUsage(actor, id);
    expect(usage.reusables).toHaveLength(1);
    expect(usage.reusables[0]?.placements).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Foreign keys
  // -------------------------------------------------------------------------

  it("counts a foreign key relation and labels it in words", async () => {
    const id = await newMedia("cover");
    const seo = await db.seo.create({ data: { ogImageId: id }, select: { id: true } });

    const usage = await mediaUsage(actor, id);
    expect(usage.entities).toEqual([{ label: "Social image", count: 1 }]);
    expect(usage.total).toBe(1);

    await db.seo.delete({ where: { id: seo.id } });
  });

  // -------------------------------------------------------------------------
  // The delete guard
  // -------------------------------------------------------------------------

  it("refuses to delete a file a page still shows, and names the page", async () => {
    const id = await newMedia("guarded");
    await newPage("The homepage", [{ type: "image", content: { mediaId: id } }]);

    await expect(deleteMedia(actor, id)).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteMedia(actor, id)).rejects.toThrow(/The homepage/);
  });

  it("allows deleting a file nothing references", async () => {
    const id = await newMedia("free");
    await expect(deleteMedia(actor, id)).resolves.toMatchObject({ id });
  });

  // -------------------------------------------------------------------------
  // Orphans
  // -------------------------------------------------------------------------

  it("lists a referenced id and omits an unreferenced one", async () => {
    const used = await newMedia("counted");
    const spare = await newMedia("uncounted");
    await newPage("Counting", [{ type: "image", content: { mediaId: used } }]);

    const referenced = await referencedMediaIds();
    expect(referenced.has(used)).toBe(true);
    expect(referenced.has(spare)).toBe(false);
  });

  it("the unused filter shows the spare file and hides the used one", async () => {
    const used = await newMedia("shown");
    const spare = await newMedia("hidden");
    await newPage("Filtering", [{ type: "image", content: { mediaId: used } }]);

    const listed = await listMedia(actor, { page: 1, perPage: 96, unused: true });
    const ids = listed.rows.map((row) => row.id);
    expect(ids).toContain(spare);
    expect(ids).not.toContain(used);
  });

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  it("stores the new descriptive fields and a focal point", async () => {
    const id = await newMedia("meta");
    await updateMedia(actor, {
      id,
      filename: "meta.png",
      title: "A title",
      caption: "Photo: someone",
      description: "Licensed until 2027.",
      focalX: 30,
      focalY: 70,
      tags: [],
    });

    const row = await db.media.findUniqueOrThrow({
      where: { id },
      select: { title: true, caption: true, description: true, focalX: true, focalY: true },
    });
    expect(row).toEqual({
      title: "A title",
      caption: "Photo: someone",
      description: "Licensed until 2027.",
      focalX: 30,
      focalY: 70,
    });
  });

  it("clears a focal point back to centre when it is blanked", async () => {
    const id = await newMedia("uncentre");
    await updateMedia(actor, { id, filename: "u.png", focalX: 10, focalY: 10, tags: [] });
    await updateMedia(actor, { id, filename: "u.png", focalX: null, focalY: null, tags: [] });

    const row = await db.media.findUniqueOrThrow({
      where: { id },
      select: { focalX: true, focalY: true },
    });
    expect(row).toEqual({ focalX: null, focalY: null });
  });

  it("creates tags that do not exist and reuses ones that do", async () => {
    const first = await newMedia("tag-a");
    const second = await newMedia("tag-b");

    await updateMedia(actor, { id: first, filename: "a.png", tags: ["Local SEO", "Team"] });
    await updateMedia(actor, { id: second, filename: "b.png", tags: ["local seo"] });

    const rows = await db.mediaTag.findMany({
      where: { mediaId: { in: [first, second] } },
      select: { mediaId: true, tag: { select: { slug: true } } },
    });

    const slugs = rows.filter((row) => row.mediaId === second).map((row) => row.tag.slug);
    expect(slugs).toEqual(["local-seo"]);
    // "Local SEO" and "local seo" are one tag, not two.
    expect(rows.filter((row) => row.tag.slug === "local-seo")).toHaveLength(2);
  });

  it("removing a tag from the list removes it from the file", async () => {
    const id = await newMedia("untag");
    await updateMedia(actor, { id, filename: "t.png", tags: ["Keep", "Drop"] });
    await updateMedia(actor, { id, filename: "t.png", tags: ["Keep"] });

    const rows = await db.mediaTag.findMany({
      where: { mediaId: id },
      select: { tag: { select: { slug: true } } },
    });
    expect(rows.map((row) => row.tag.slug)).toEqual(["keep"]);
  });

  it("filters the library by tag", async () => {
    const id = await newMedia("filtered");
    await updateMedia(actor, { id, filename: "f.png", tags: [`Only${SUFFIX}`] });

    const listed = await listMedia(actor, {
      page: 1,
      perPage: 96,
      unused: false,
      tag: `only${SUFFIX}`,
    });
    expect(listed.rows.map((row) => row.id)).toEqual([id]);
  });
});
