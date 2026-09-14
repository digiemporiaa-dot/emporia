import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { generateBlocks, generateMeta, rewriteField } from "@/lib/services/ai.service";
import { resetEnvCache } from "@/lib/config/env";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { rewriteSchema } from "@/lib/validation/ai-cms";
import { startAnthropicDouble, type AnthropicDouble } from "./support/anthropic-double";
import type { Actor } from "@/lib/actor/types";

/**
 * The CMS assistant.
 *
 * Two properties matter more than the wording it produces.
 *
 * **Nothing here writes.** Every function returns a draft; applying it is an
 * ordinary save the editor makes afterwards. The tests below check the database
 * is untouched after a call, because that is the master brief's rule and a
 * comment is not an enforcement.
 *
 * **Model output is validated, not trusted.** A block the model invents fields
 * for, or a type it was not asked for, is rejected against the real block
 * schemas before an editor ever sees it.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `aicms-${Date.now()}`;

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

describe("rewrite input", () => {
  it("insists on a language when translating", () => {
    const base = { text: "Some copy here.", action: "translate" as const };
    expect(rewriteSchema.safeParse(base).success).toBe(false);
    expect(rewriteSchema.safeParse({ ...base, language: "Hindi" }).success).toBe(true);
  });

  it("refuses text longer than one field's worth", () => {
    const result = rewriteSchema.safeParse({ text: "x".repeat(4_001), action: "rewrite" });
    expect(result.success).toBe(false);
  });

  it("refuses an action it does not offer", () => {
    // A closed list, not a prompt box: an open instruction on a field is a
    // prompt-injection surface and an unbounded cost.
    expect(rewriteSchema.safeParse({ text: "Copy.", action: "ignore all rules" }).success).toBe(
      false,
    );
  });
});

describeDb("the CMS assistant", () => {
  let double: AnthropicDouble;
  let editor: Actor;
  let outsider: Actor;
  const pages: string[] = [];

  beforeAll(async () => {
    double = await startAnthropicDouble();
    process.env["AI_PROVIDER"] = "anthropic";
    process.env["AI_API_KEY"] = "test-key";
    process.env["AI_BASE_URL"] = double.url;
    resetEnvCache();

    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    editor = actorWith(staff.id, ["ai.use", "pages.edit", "pages.view", "seo.edit"]);
    outsider = actorWith(staff.id, ["pages.edit", "pages.view", "seo.edit"]);

    // The spend guard is backed by a table, not by process memory, so its
    // window survives between runs — running this file twice inside a minute
    // otherwise exhausts the ten-per-minute block budget and every assertion
    // fails as a rate limit. Clearing this suite's own keys isolates it
    // without weakening the guard, which has its own test elsewhere.
    await db.rateLimitWindow.deleteMany({
      where: { key: { in: [
        `ai:rewriteField:${staff.id}`,
        `ai:generateBlocks:${staff.id}`,
        `ai:generateMeta:${staff.id}`,
      ] } },
    });
  });

  afterAll(async () => {
    await db.pageSection.deleteMany({ where: { pageId: { in: pages } } });
    await db.page.deleteMany({ where: { id: { in: pages } } });
    await double.close();
    delete process.env["AI_BASE_URL"];
    resetEnvCache();
  });

  async function newPage(body: string) {
    const page = await db.page.create({
      data: {
        slug: `${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
        title: "A page to assist",
        status: "DRAFT",
        sections: { create: [{ type: "richText", order: 0, content: { body } }] },
      },
      select: { id: true },
    });
    pages.push(page.id);
    return page.id;
  }

  // -------------------------------------------------------------------------
  // Rewriting
  // -------------------------------------------------------------------------

  it("returns a draft that is labelled as generated", async () => {
    double.reply("A tidier sentence.");
    const draft = await rewriteField(editor, { text: "A sentence, but messy.", action: "rewrite" });

    expect(draft.generated).toBe(true);
    expect(draft.task).toBe("rewriteField");
    expect(draft.data).toBe("A tidier sentence.");
  });

  it("sends the text and the instruction, and nothing else", async () => {
    double.reply("Shorter.");
    await rewriteField(editor, { text: "A long rambling sentence.", action: "shorten" });

    const sent = double.requests.at(-1);
    expect(sent?.prompt).toContain("A long rambling sentence.");
    expect(sent?.prompt).toMatch(/shorter/i);
    // The system prompt is what forbids invention, so it must actually be sent.
    expect(sent?.system).toMatch(/Never invent a fact/);
  });

  it("names the language when translating", async () => {
    double.reply("अनुवादित।");
    await rewriteField(editor, { text: "Some copy.", action: "translate", language: "Hindi" });
    expect(double.requests.at(-1)?.prompt).toContain("Hindi");
  });

  it("needs ai.use", async () => {
    await expect(
      rewriteField(outsider, { text: "Copy.", action: "rewrite" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // -------------------------------------------------------------------------
  // Blocks — validated, not trusted
  // -------------------------------------------------------------------------

  it("returns blocks that pass the real block schemas", async () => {
    const pageId = await newPage("Existing copy on the page.");
    double.reply({
      blocks: [
        { type: "richText", content: { body: "A drafted paragraph." } },
        { type: "heading", content: { text: "A drafted heading" } },
      ],
    });

    const draft = await generateBlocks(editor, {
      pageId,
      brief: "A page about our approach to local search.",
      blocks: ["richText", "heading"],
    });

    expect(draft.generated).toBe(true);
    expect(draft.data.blocks.map((b) => b.type)).toEqual(["richText", "heading"]);
    expect(draft.data.rejected).toEqual([]);
  });

  it("rejects a block whose content does not fit its schema, and says so", async () => {
    const pageId = await newPage("Existing copy.");
    double.reply({
      blocks: [
        { type: "richText", content: { body: "Fine." } },
        // `body` must be a string; the model returning a number is exactly the
        // case an editor must never be handed.
        { type: "richText", content: { body: 42 } },
      ],
    });

    const draft = await generateBlocks(editor, {
      pageId,
      brief: "A page about something.",
      blocks: ["richText"],
    });

    expect(draft.data.blocks).toHaveLength(1);
    expect(draft.data.rejected).toEqual(["richText"]);
  });

  it("rejects a block type nobody asked for", async () => {
    const pageId = await newPage("Existing copy.");
    double.reply({
      blocks: [
        { type: "richText", content: { body: "Asked for." } },
        { type: "notARealBlock", content: {} },
      ],
    });

    const draft = await generateBlocks(editor, {
      pageId,
      brief: "A page about something.",
      blocks: ["richText"],
    });

    expect(draft.data.blocks).toHaveLength(1);
    expect(draft.data.rejected).toContain("notARealBlock");
  });

  it("strips fields the block has no place for", async () => {
    const pageId = await newPage("Existing copy.");
    double.reply({
      blocks: [{ type: "richText", content: { body: "Kept.", invented: "dropped" } }],
    });

    const draft = await generateBlocks(editor, {
      pageId,
      brief: "A page about something.",
      blocks: ["richText"],
    });

    expect(draft.data.blocks[0]?.content).not.toHaveProperty("invented");
  });

  it("refuses bands the page's template does not allow", async () => {
    const template = await db.pageTemplate.create({
      data: {
        key: `${SUFFIX}-tpl`,
        name: "Restricted",
        sections: [],
        allowedBlocks: ["richText"],
      },
      select: { id: true },
    });
    const page = await db.page.create({
      data: {
        slug: `${SUFFIX}-restricted`,
        title: "Restricted page",
        status: "DRAFT",
        templateId: template.id,
      },
      select: { id: true },
    });
    pages.push(page.id);

    // Suggesting a band the editor cannot then add would be a suggestion
    // designed to be refused.
    await expect(
      generateBlocks(editor, { pageId: page.id, brief: "Anything at all.", blocks: ["table"] }),
    ).rejects.toBeInstanceOf(ValidationError);

    await db.page.delete({ where: { id: page.id } });
    pages.pop();
    await db.pageTemplate.delete({ where: { id: template.id } });
  });

  // -------------------------------------------------------------------------
  // Meta
  // -------------------------------------------------------------------------

  it("refuses to describe a page with nothing on it", async () => {
    // A plausible description of an empty page is the worst thing this could
    // produce, so it is refused rather than guessed.
    const pageId = await newPage("Too short.");
    await expect(generateMeta(editor, { pageId })).rejects.toBeInstanceOf(ValidationError);
  });

  it("drafts from what the page actually says", async () => {
    const body = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const pageId = await newPage(body);

    double.reply({
      metaTitle: "A title of roughly the right length for a result",
      metaDescription: "A description of the page, long enough to be useful in a search result.",
    });

    const draft = await generateMeta(editor, { pageId });
    expect(draft.generated).toBe(true);
    expect(draft.data.metaTitle).toMatch(/A title/);
    // The page's own words are what it was given.
    expect(double.requests.at(-1)?.prompt).toContain("word0");
  });

  // -------------------------------------------------------------------------
  // The rule that matters most
  // -------------------------------------------------------------------------

  it("writes nothing to the page it was asked about", async () => {
    const pageId = await newPage("Existing copy that must survive.");
    const before = await db.pageSection.findMany({
      where: { pageId },
      select: { content: true },
    });

    double.reply({ blocks: [{ type: "richText", content: { body: "A draft." } }] });
    await generateBlocks(editor, { pageId, brief: "A brief about things.", blocks: ["richText"] });

    const after = await db.pageSection.findMany({ where: { pageId }, select: { content: true } });
    // The draft exists only in the reply. Applying it is a save the editor makes.
    expect(after).toEqual(before);
    expect(after).toHaveLength(1);
  });

  it("writes nothing to the SEO record either", async () => {
    const body = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const pageId = await newPage(body);

    double.reply({ metaTitle: "A drafted title", metaDescription: "A drafted description." });
    await generateMeta(editor, { pageId });

    const page = await db.page.findUniqueOrThrow({
      where: { id: pageId },
      select: { seoId: true, seo: { select: { metaTitle: true } } },
    });
    expect(page.seo?.metaTitle ?? null).toBeNull();
  });

  it("audits every call, so a provider bill has a trail", async () => {
    const pageId = await newPage("Existing copy.");
    double.reply({ blocks: [{ type: "richText", content: { body: "A draft." } }] });
    await generateBlocks(editor, { pageId, brief: "A brief about things.", blocks: ["richText"] });

    // Recorded the way every other assist is: one AIDraft row per call, keyed
    // by task and subject, carrying the model and the token counts.
    const entries = await db.auditLog.count({
      where: { entityType: "AIDraft", entityId: `generateBlocks:${pageId}` },
    });
    expect(entries).toBeGreaterThanOrEqual(1);
  });
});
