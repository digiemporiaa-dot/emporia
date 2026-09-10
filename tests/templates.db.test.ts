import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
} from "@/lib/services/template.service";
import { allowedBlocksOf, startingSections, templatePermits } from "@/lib/content/templates";
import { addSection, createPage } from "@/lib/services/page.service";
import { templateSchema } from "@/lib/validation/template";
import { BLOCK_LIBRARY, blockDefinition } from "@/lib/content/blocks";
import type { Actor } from "@/lib/actor/types";

/**
 * Page templates.
 *
 * The parts that have to be right: a template's restriction is enforced when a
 * band is added rather than only hidden from the picker; a template is applied
 * at creation and never afterwards; and deleting one cannot quietly lift its
 * restriction on the pages made from it.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `tpl-${Date.now()}`;

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

describe("what a template permits", () => {
  it("permits everything when the list is empty", () => {
    // The restriction is opt-in per template, not the default state of the CMS.
    expect(templatePermits([], "richText")).toBe(true);
    expect(templatePermits([], "anything")).toBe(true);
  });

  it("permits only what is listed once anything is listed", () => {
    expect(templatePermits(["richText", "faq"], "richText")).toBe(true);
    expect(templatePermits(["richText", "faq"], "table")).toBe(false);
  });

  it("ignores a stored value that is not a list of real blocks", () => {
    expect(allowedBlocksOf(null)).toEqual([]);
    expect(allowedBlocksOf("richText")).toEqual([]);
    expect(allowedBlocksOf(["richText", "notABlock", 7])).toEqual(["richText"]);
  });
});

describe("starting sections", () => {
  it("returns the bands a template opens with, in order", () => {
    const sections = startingSections([
      { type: "richText", content: { body: "Hello" } },
      { type: "heading", content: { text: "How we work" } },
    ]);
    expect(sections.map((section) => section.type)).toEqual(["richText", "heading"]);
  });

  it("drops a band that no longer parses rather than failing the page", () => {
    // A broken template should cost one section, not the whole creation.
    const sections = startingSections([
      { type: "richText", content: { body: "Fine" } },
      { type: "richText", content: { body: 42 } },
    ]);
    expect(sections).toHaveLength(1);
  });

  it("ignores an entry that is not a block at all", () => {
    expect(startingSections([{ type: "notABlock" }, null, "nonsense"])).toEqual([]);
  });

  it("returns nothing for a template with no sections", () => {
    expect(startingSections([])).toEqual([]);
    expect(startingSections(null)).toEqual([]);
  });
});

describe("every block can open a page", () => {
  it("accepts each block in the library as a starting section from its own defaults", () => {
    // The template form posts only a block's type — the words are written on
    // the page, not in the template. So every block's library defaults must
    // satisfy its own schema, or the form would offer a band it cannot save.
    const failed = BLOCK_LIBRARY.filter(
      (block) => startingSections([{ type: block.type, content: blockDefinition(block.type).defaults }]).length === 0,
    );
    expect(failed.map((block) => block.type)).toEqual([]);
  });
});

describe("template validation", () => {
  it("refuses a handle with spaces or capitals", () => {
    const base = { key: "Service Landing", name: "Service landing" };
    expect(templateSchema.safeParse(base).success).toBe(false);
    expect(templateSchema.safeParse({ ...base, key: "service-landing" }).success).toBe(true);
  });

  it("defaults to no sections, no restriction and indexable", () => {
    const parsed = templateSchema.parse({ key: "blank", name: "Blank" });
    expect(parsed.sections).toEqual([]);
    expect(parsed.allowedBlocks).toEqual([]);
    expect(parsed.defaultRobotsIndex).toBe(true);
    expect(parsed.defaultSchemaType).toBe("NONE");
  });

  it("refuses a block type that does not exist", () => {
    const result = templateSchema.safeParse({
      key: "bad",
      name: "Bad",
      allowedBlocks: ["notABlock"],
    });
    expect(result.success).toBe(false);
  });
});

describeDb("templates", () => {
  const templates: string[] = [];
  const pages: string[] = [];
  let publisher: Actor;
  let editor: Actor;

  beforeAll(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    publisher = actorWith(staff.id, [
      "pages.view",
      "pages.create",
      "pages.edit",
      "pages.publish",
      "seo.edit",
    ]);
    editor = actorWith(staff.id, ["pages.view", "pages.create", "pages.edit"]);
  });

  afterAll(async () => {
    await db.pageSection.deleteMany({ where: { pageId: { in: pages } } });
    await db.page.deleteMany({ where: { id: { in: pages } } });
    await db.pageTemplate.deleteMany({ where: { id: { in: templates } } });
  });

  async function newTemplate(over: Partial<Parameters<typeof createTemplate>[1]> = {}) {
    const created = await createTemplate(publisher, {
      key: `${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
      name: "A template",
      sections: [],
      allowedBlocks: [],
      defaultSchemaType: "NONE",
      defaultRobotsIndex: true,
      isActive: true,
      order: 0,
      ...over,
    });
    templates.push(created.id);
    return created;
  }

  async function newPage(templateId?: string) {
    const page = await createPage(publisher, {
      title: `Templated ${SUFFIX} ${Math.random().toString(36).slice(2, 8)}`,
      ...(templateId ? { templateId } : {}),
    });
    pages.push(page.id);
    return page;
  }

  // -------------------------------------------------------------------------
  // Managing templates
  // -------------------------------------------------------------------------

  it("needs pages.publish to create one, because it decides what pages may hold", async () => {
    await expect(
      createTemplate(editor, {
        key: `${SUFFIX}-denied`,
        name: "Denied",
        sections: [],
        allowedBlocks: [],
        defaultSchemaType: "NONE",
        defaultRobotsIndex: true,
        isActive: true,
        order: 0,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a handle already in use", async () => {
    const first = await newTemplate();
    await expect(newTemplate({ key: first.key })).rejects.toBeInstanceOf(ConflictError);
  });

  it("stores starting sections parsed, not as they arrived", async () => {
    const template = await newTemplate({
      sections: [{ type: "richText", content: { body: "Hello", unknownKey: "dropped" } }],
    });

    const stored = startingSections(template.sections);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.content).not.toHaveProperty("unknownKey");
  });

  it("refuses a starting section whose content does not fit its block", async () => {
    await expect(
      newTemplate({ sections: [{ type: "richText", content: { body: 42 } }] }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("hides a switched-off template from the New page list but keeps it findable", async () => {
    const off = await newTemplate({ isActive: false });

    const offered = await listTemplates(publisher);
    expect(offered.map((row) => row.id)).not.toContain(off.id);

    const all = await listTemplates(publisher, true);
    expect(all.map((row) => row.id)).toContain(off.id);
  });

  // -------------------------------------------------------------------------
  // Creating a page from one
  // -------------------------------------------------------------------------

  it("creates a blank page when no template is chosen", async () => {
    const page = await newPage();
    const sections = await db.pageSection.count({ where: { pageId: page.id } });
    expect(sections).toBe(0);
    expect(page.templateId).toBeNull();
  });

  it("opens a page with the template's bands, in order", async () => {
    const template = await newTemplate({
      sections: [
        { type: "hero", content: { heading: "A heading long enough" } },
        { type: "richText", content: { body: "Some words." } },
      ],
    });
    const page = await newPage(template.id);

    const sections = await db.pageSection.findMany({
      where: { pageId: page.id },
      orderBy: { order: "asc" },
      select: { type: true },
    });
    expect(sections.map((s) => s.type)).toEqual(["hero", "richText"]);
  });

  it("applies the template's SEO defaults to the new page", async () => {
    const template = await newTemplate({
      defaultSchemaType: "FAQ_PAGE",
      defaultRobotsIndex: false,
    });
    const page = await newPage(template.id);

    const withSeo = await db.page.findUniqueOrThrow({
      where: { id: page.id },
      select: { seo: { select: { schemaType: true, robotsIndex: true } } },
    });
    expect(withSeo.seo?.schemaType).toBe("FAQ_PAGE");
    expect(withSeo.seo?.robotsIndex).toBe(false);
  });

  it("refuses a template that does not exist", async () => {
    await expect(
      createPage(publisher, { title: "Nope", templateId: "cnosuchtemplate000000000" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a template that has been switched off", async () => {
    // A form left open before it was withdrawn must not still use it.
    const off = await newTemplate({ isActive: false });
    await expect(
      createPage(publisher, { title: "Stale form", templateId: off.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not reach back into pages already made from it", async () => {
    const template = await newTemplate({
      sections: [{ type: "richText", content: { body: "Original." } }],
    });
    const page = await newPage(template.id);

    await updateTemplate(publisher, template.id, {
      key: template.key,
      name: template.name,
      sections: [
        { type: "richText", content: { body: "Changed." } },
        { type: "heading", content: { text: "And another band" } },
      ],
      allowedBlocks: [],
      defaultSchemaType: "NONE",
      defaultRobotsIndex: true,
      isActive: true,
      order: 0,
    });

    // Propagating would be a second, invisible way to change a live page.
    const sections = await db.pageSection.findMany({
      where: { pageId: page.id },
      select: { type: true },
    });
    expect(sections).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // The restriction
  // -------------------------------------------------------------------------

  it("refuses a band the template does not allow, in the service", async () => {
    const template = await newTemplate({ allowedBlocks: ["richText"] });
    const page = await newPage(template.id);

    await expect(addSection(publisher, page.id, "table")).rejects.toBeInstanceOf(ValidationError);
    await expect(addSection(publisher, page.id, "table")).rejects.toThrow(/does not allow/i);
  });

  it("allows a band the template lists", async () => {
    const template = await newTemplate({ allowedBlocks: ["richText"] });
    const page = await newPage(template.id);

    await expect(addSection(publisher, page.id, "richText")).resolves.toMatchObject({
      type: "richText",
    });
  });

  it("allows anything on a page with no template", async () => {
    const page = await newPage();
    await expect(addSection(publisher, page.id, "table")).resolves.toMatchObject({
      type: "table",
    });
  });

  it("allows anything when the template restricts nothing", async () => {
    const template = await newTemplate({ allowedBlocks: [] });
    const page = await newPage(template.id);
    await expect(addSection(publisher, page.id, "table")).resolves.toMatchObject({
      type: "table",
    });
  });

  // -------------------------------------------------------------------------
  // Deleting
  // -------------------------------------------------------------------------

  it("refuses to delete a template pages still use", async () => {
    // Deleting would null their templateId and lift the restriction on all of
    // them, invisibly.
    const template = await newTemplate({ allowedBlocks: ["richText"] });
    await newPage(template.id);

    await expect(deleteTemplate(publisher, template.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteTemplate(publisher, template.id)).rejects.toThrow(/switch it off/i);
  });

  it("deletes one nothing uses", async () => {
    const template = await newTemplate();
    await expect(deleteTemplate(publisher, template.id)).resolves.toMatchObject({
      id: template.id,
    });
  });
});
