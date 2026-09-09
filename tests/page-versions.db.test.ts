import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import * as pageService from "@/lib/services/page.service";
import * as versions from "@/lib/services/page-version.service";
import { diffSnapshots, type PageSnapshot } from "@/lib/services/page-version.service";
import { stampVersion } from "@/lib/content/migrations";
import type { Actor } from "@/lib/actor/types";

/**
 * Page version history and editorial workflow.
 *
 * The builder writes straight to `PageSection`, so an edit is live the moment
 * it is saved. That makes two things load-bearing: a version is taken for every
 * publish, and restoring one is itself undoable. Both are asserted here, along
 * with the transitions the workflow refuses.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `ver-${Date.now()}`;

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

describeDb("page versions", () => {
  const pages: string[] = [];
  let editor: Actor;
  let publisher: Actor;

  beforeEach(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    editor = actorWith(staff.id, ["pages.view", "pages.edit", "pages.create"]);
    publisher = actorWith(staff.id, [
      "pages.view",
      "pages.edit",
      "pages.create",
      "pages.publish",
      "pages.delete",
    ]);
  });

  afterAll(async () => {
    await db.page.deleteMany({ where: { id: { in: pages } } });
  });

  async function newPage(title: string, sections: { type: string; content: object }[] = []) {
    const page = await db.page.create({
      data: {
        slug: `${title.toLowerCase().replace(/\s+/g, "-")}-${SUFFIX}-${Math.random().toString(36).slice(2, 7)}`,
        title,
        status: "DRAFT",
        sections: {
          create: sections.map((section, index) => ({
            type: section.type,
            order: index,
            content: stampVersion(section.content),
          })),
        },
      },
      select: { id: true },
    });
    pages.push(page.id);
    return page.id;
  }

  // -------------------------------------------------------------------------
  // Snapshots
  // -------------------------------------------------------------------------

  it("takes a version every time a page is published", async () => {
    const id = await newPage("Publishing", [{ type: "richText", content: { body: "One" } }]);

    expect(await versions.listVersions(editor, id)).toHaveLength(0);

    await pageService.setPageStatus(publisher, id, "PUBLISHED");
    const list = await versions.listVersions(editor, id);
    expect(list).toHaveLength(1);
    expect(list[0]?.version).toBe(1);
    expect(list[0]?.reason).toBe("Published");
  });

  it("does not take one for unpublishing — nothing new was said", async () => {
    const id = await newPage("Unpublishing", [{ type: "richText", content: { body: "One" } }]);
    await pageService.setPageStatus(publisher, id, "PUBLISHED");
    await pageService.setPageStatus(publisher, id, "DRAFT");
    expect(await versions.listVersions(editor, id)).toHaveLength(1);
  });

  it("numbers versions sequentially per page", async () => {
    const id = await newPage("Numbering", [{ type: "richText", content: { body: "One" } }]);
    await versions.saveVersion(editor, id, "First");
    await versions.saveVersion(editor, id, "Second");
    await versions.saveVersion(editor, id, "Third");

    expect((await versions.listVersions(editor, id)).map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it("captures the sections as they stand, in order", async () => {
    const id = await newPage("Capture", [
      { type: "richText", content: { body: "First" } },
      { type: "heading", content: { text: "Second" } },
    ]);
    await versions.saveVersion(editor, id, "As built");

    const stored = await versions.getVersion(editor, id, 1);
    expect(stored.snapshot.sections.map((s) => s.type)).toEqual(["richText", "heading"]);
    expect(stored.snapshot.title).toBe("Capture");
  });

  // -------------------------------------------------------------------------
  // Restore
  // -------------------------------------------------------------------------

  it("puts the page back, and keeps what it replaced as a version of its own", async () => {
    const id = await newPage("Restoring", [{ type: "richText", content: { body: "Original" } }]);
    await versions.saveVersion(editor, id, "The good one");

    // Edit it into a state we want back out of.
    await db.pageSection.deleteMany({ where: { pageId: id } });
    await db.pageSection.create({
      data: { pageId: id, type: "heading", order: 0, content: stampVersion({ text: "Ruined" }) },
    });

    await versions.restoreVersion(editor, id, 1);

    const sections = await db.pageSection.findMany({
      where: { pageId: id },
      orderBy: { order: "asc" },
      select: { type: true, content: true },
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]?.type).toBe("richText");

    // The ruined state is itself recoverable: restoring is not a one-way door.
    const list = await versions.listVersions(editor, id);
    expect(list.map((v) => v.reason)).toContain("Before restoring v1");
    const kept = await versions.getVersion(editor, id, 2);
    expect(kept.snapshot.sections[0]?.type).toBe("heading");
  });

  it("does not change whether the page is published", async () => {
    const id = await newPage("Still live", [{ type: "richText", content: { body: "One" } }]);
    await pageService.setPageStatus(publisher, id, "PUBLISHED");
    await versions.restoreVersion(editor, id, 1);

    const page = await db.page.findUniqueOrThrow({ where: { id }, select: { status: true } });
    expect(page.status).toBe("PUBLISHED");
  });

  it("keeps the current slug when the version's address now belongs to another page", async () => {
    const id = await newPage("Slug clash", [{ type: "richText", content: { body: "One" } }]);
    const original = await db.page.findUniqueOrThrow({ where: { id }, select: { slug: true } });
    await versions.saveVersion(editor, id, "With the old slug");

    // The page moves, and something else takes the address it had.
    await db.page.update({ where: { id }, data: { slug: `${original.slug}-moved` } });
    const squatter = await db.page.create({
      data: { slug: original.slug, title: "Squatter", status: "DRAFT" },
      select: { id: true },
    });
    pages.push(squatter.id);

    const restored = await versions.restoreVersion(editor, id, 1);
    // Failing the whole restore over an address would make history unusable.
    expect(restored.slugKept).toBe(true);
    expect(restored.slug).toBe(`${original.slug}-moved`);
  });

  it("refuses a version that does not exist", async () => {
    const id = await newPage("Missing");
    await expect(versions.restoreVersion(editor, id, 99)).rejects.toBeInstanceOf(NotFoundError);
  });

  // -------------------------------------------------------------------------
  // Permissions
  // -------------------------------------------------------------------------

  it("gates every operation on a permission", async () => {
    const id = await newPage("Gated", [{ type: "richText", content: { body: "One" } }]);
    await versions.saveVersion(editor, id, "One");
    const nobody = actorWith(editor.userId, []);

    await expect(versions.listVersions(nobody, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(versions.saveVersion(nobody, id, "x")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(versions.restoreVersion(nobody, id, 1)).rejects.toBeInstanceOf(ForbiddenError);
    // Deleting history needs more than being able to edit.
    await expect(versions.deleteVersion(editor, id, 1)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("will not delete the last version, which is the one that matters most", async () => {
    const id = await newPage("Only one", [{ type: "richText", content: { body: "One" } }]);
    await versions.saveVersion(editor, id, "The only one");
    await expect(versions.deleteVersion(publisher, id, 1)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("comparing snapshots", () => {
  const base: PageSnapshot = {
    title: "A page",
    slug: "a-page",
    internalName: null,
    description: null,
    sections: [
      { type: "richText", order: 0, name: null, isVisible: true, content: { body: "One" }, reusableSectionId: null },
      { type: "heading", order: 1, name: null, isVisible: true, content: { text: "Two" }, reusableSectionId: null },
    ],
  };

  it("says when nothing changed, rather than showing a blank", () => {
    expect(diffSnapshots(base, base).identical).toBe(true);
  });

  it("reports a changed page detail with both values", () => {
    const diff = diffSnapshots(base, { ...base, title: "Renamed" });
    expect(diff.fields).toEqual([{ field: "Title", from: "A page", to: "Renamed" }]);
  });

  it("reports an added section", () => {
    const diff = diffSnapshots(base, {
      ...base,
      sections: [
        ...base.sections,
        { type: "cta", order: 2, name: null, isVisible: true, content: {}, reusableSectionId: null },
      ],
    });
    expect(diff.sections).toEqual([{ kind: "added", label: "Call to action", position: 3 }]);
  });

  it("reports a removed section", () => {
    const diff = diffSnapshots(base, { ...base, sections: [base.sections[0]!] });
    expect(diff.sections[0]?.kind).toBe("removed");
  });

  it("reports edited content", () => {
    const diff = diffSnapshots(base, {
      ...base,
      sections: [
        { ...base.sections[0]!, content: { body: "Rewritten" } },
        base.sections[1]!,
      ],
    });
    expect(diff.sections).toEqual([{ kind: "changed", label: "Rich text", position: 1 }]);
  });

  it("notices a section being hidden, which changes the page as much as deleting it", () => {
    const diff = diffSnapshots(base, {
      ...base,
      sections: [{ ...base.sections[0]!, isVisible: false }, base.sections[1]!],
    });
    expect(diff.sections[0]?.kind).toBe("changed");
  });

  it("reads a replaced section as one out and one in", () => {
    const diff = diffSnapshots(base, {
      ...base,
      sections: [
        { type: "cta", order: 0, name: null, isVisible: true, content: {}, reusableSectionId: null },
        base.sections[1]!,
      ],
    });
    expect(diff.sections.map((s) => s.kind)).toEqual(["removed", "added"]);
  });

  it("uses the editor's own name for a section when it has one", () => {
    const diff = diffSnapshots(base, {
      ...base,
      sections: [{ ...base.sections[0]!, name: "The opener", content: { body: "New" } }],
    });
    expect(diff.sections[0]?.label).toBe("The opener");
  });
});
