import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as pageService from "@/lib/services/page.service";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { BLOCK_LIBRARY } from "@/lib/content/blocks";
import type { Actor } from "@/lib/actor/types";

/**
 * The page builder's section operations, against the real database.
 *
 * Ordering is the thing most worth pinning: add appends, duplicate lands
 * beside its original, delete closes the gap. A page whose sections silently
 * share a position renders in an arbitrary order, and nothing in the UI would
 * show it.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

function actorWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Builder",
    email: "builder@emporia.test",
    type: "STAFF",
    roleName: "CONTENT_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

describeDb("page builder sections", () => {
  const pages: string[] = [];
  let editor: Actor;

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    editor = actorWith(user.id, ["pages.view", "pages.create", "pages.edit"]);
  });

  afterAll(async () => {
    if (pages.length > 0) await db.page.deleteMany({ where: { id: { in: pages } } });
  });

  async function newPage(title: string) {
    const page = await pageService.createPage(editor, { title });
    pages.push(page.id);
    return page;
  }

  const orderOf = async (pageId: string) =>
    (
      await db.pageSection.findMany({
        where: { pageId },
        orderBy: { order: "asc" },
        select: { id: true, order: true, type: true },
      })
    ).map((s) => s.order);

  it("every block in the library creates with valid defaults", async () => {
    const page = await newPage("All blocks");

    for (const block of BLOCK_LIBRARY) {
      // Passes only if the defaults satisfy the block's own zod schema — which
      // is what stops a freshly added section rendering as an error.
      const section = await pageService.addSection(editor, page.id, block.type);
      expect(section.type).toBe(block.type);
    }

    const full = await pageService.getPage(editor, page.id);
    expect(full.sections).toHaveLength(BLOCK_LIBRARY.length);
    expect(await orderOf(page.id)).toEqual(BLOCK_LIBRARY.map((_, i) => i));
  });

  it("refuses a type that is not a builder block", async () => {
    const page = await newPage("Bad type");
    await expect(pageService.addSection(editor, page.id, "legal")).rejects.toThrow(ValidationError);
    await expect(pageService.addSection(editor, page.id, "nonsense")).rejects.toThrow(
      ValidationError,
    );
  });

  it("stores the parsed content, dropping keys the schema does not declare", async () => {
    const page = await newPage("Parsed content");
    const section = await pageService.addSection(editor, page.id, "heading");

    const saved = await pageService.updateSection(editor, section.id, {
      content: { text: "  Real heading  ", level: 3, align: "center", smuggled: "nope" },
    });

    expect(saved.content).toEqual({ text: "Real heading", level: 3, align: "center" });
  });

  it("rejects invalid content and names the field", async () => {
    const page = await newPage("Invalid content");
    const section = await pageService.addSection(editor, page.id, "heading");

    await expect(
      pageService.updateSection(editor, section.id, { content: { text: "x" } }),
    ).rejects.toMatchObject({ code: "VALIDATION", details: { text: expect.any(Array) } });
  });

  it("refuses an external link in a call to action", async () => {
    const page = await newPage("External cta");
    const section = await pageService.addSection(editor, page.id, "feature");

    await expect(
      pageService.updateSection(editor, section.id, {
        content: {
          heading: "Heading",
          bullets: [],
          ctaLabel: "Go",
          ctaHref: "https://evil.example.com",
        },
      }),
    ).rejects.toThrow(/must start with \//i);
  });

  it("will not let the builder edit a bespoke section type", async () => {
    const page = await newPage("Bespoke");
    const section = await db.pageSection.create({
      data: { pageId: page.id, type: "legal", order: 0, content: { clauses: [] } },
      select: { id: true },
    });

    await expect(
      pageService.updateSection(editor, section.id, { content: { clauses: [] } }),
    ).rejects.toThrow(/cannot be edited in the builder/i);
  });

  it("duplicates a section directly beneath its original", async () => {
    const page = await newPage("Duplicate order");
    const first = await pageService.addSection(editor, page.id, "heading");
    await pageService.addSection(editor, page.id, "richText");
    await pageService.addSection(editor, page.id, "table");

    const copy = await pageService.duplicateSection(editor, first.id);

    const sections = await db.pageSection.findMany({
      where: { pageId: page.id },
      orderBy: { order: "asc" },
      select: { id: true, type: true },
    });
    expect(sections.map((s) => s.type)).toEqual(["heading", "heading", "richText", "table"]);
    expect(sections[1]?.id).toBe(copy.id);
    expect(await orderOf(page.id)).toEqual([0, 1, 2, 3]);
  });

  it("closes the gap when a section is deleted", async () => {
    const page = await newPage("Delete gap");
    await pageService.addSection(editor, page.id, "heading");
    const middle = await pageService.addSection(editor, page.id, "richText");
    await pageService.addSection(editor, page.id, "table");

    await pageService.deleteSection(editor, middle.id);

    const sections = await db.pageSection.findMany({
      where: { pageId: page.id },
      orderBy: { order: "asc" },
      select: { type: true, order: true },
    });
    expect(sections.map((s) => s.type)).toEqual(["heading", "table"]);
    expect(sections.map((s) => s.order)).toEqual([0, 1]);
  });

  it("hides a section without removing it or moving it", async () => {
    const page = await newPage("Hide section");
    const section = await pageService.addSection(editor, page.id, "heading");

    const hidden = await pageService.setSectionVisible(editor, section.id, false);
    expect(hidden.isVisible).toBe(false);
    expect(hidden.order).toBe(section.order);

    const still = await db.pageSection.findUnique({ where: { id: section.id } });
    expect(still).not.toBeNull();
  });

  it("refuses every section mutation for an actor without pages.edit", async () => {
    const page = await newPage("No permission");
    const section = await pageService.addSection(editor, page.id, "heading");
    const viewer = actorWith(editor.userId, ["pages.view"]);

    await expect(pageService.addSection(viewer, page.id, "heading")).rejects.toThrow(ForbiddenError);
    await expect(
      pageService.updateSection(viewer, section.id, { content: { text: "Nope" } }),
    ).rejects.toThrow(ForbiddenError);
    await expect(pageService.duplicateSection(viewer, section.id)).rejects.toThrow(ForbiddenError);
    await expect(pageService.setSectionVisible(viewer, section.id, false)).rejects.toThrow(
      ForbiddenError,
    );
    await expect(pageService.deleteSection(viewer, section.id)).rejects.toThrow(ForbiddenError);
  });

  it("will not touch a section belonging to a soft-deleted page", async () => {
    const page = await newPage("Deleted page sections");
    const section = await pageService.addSection(editor, page.id, "heading");
    await db.page.update({ where: { id: page.id }, data: { deletedAt: new Date() } });

    await expect(
      pageService.updateSection(editor, section.id, { content: { text: "Heading" } }),
    ).rejects.toThrow(/does not exist/i);
  });
});
