import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as pageService from "@/lib/services/page.service";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { parseSections } from "@/lib/content/sections";
import { resolveGrid } from "@/lib/content/grid";
import type { Actor } from "@/lib/actor/types";

/**
 * The layout controls, end to end through the service.
 *
 * The point of these is the round trip: what the editor saves is what comes
 * back parsed, an invalid configuration is refused rather than stored, and a
 * section written before any of this existed still renders.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

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

describeDb("section layout controls", () => {
  const pages: string[] = [];
  let editor: Actor;
  let reader: Actor;

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    editor = actorWith(user.id, ["pages.view", "pages.create", "pages.edit"]);
    reader = actorWith(user.id, ["pages.view"]);
  });

  afterAll(async () => {
    if (pages.length > 0) await db.page.deleteMany({ where: { id: { in: pages } } });
  });

  async function newPage(title: string) {
    const page = await pageService.createPage(editor, { title: `${title} ${Date.now()}` });
    pages.push(page.id);
    return page;
  }

  it("round-trips a full band configuration", async () => {
    const page = await newPage("Band");
    const section = await pageService.addSection(editor, page.id, "benefits");

    const saved = await pageService.updateSection(editor, section.id, {
      content: {
        heading: "Benefits of the thing",
        body: "Why it is worth having.",
        items: [
          { icon: "check", title: "First", text: "" },
          { icon: "check", title: "Second", text: "" },
        ],
        grid: { desktop: 2, tablet: 2, mobile: 1, gap: "lg" },
        iconStyle: "check",
        iconColor: "red",
        imageSide: "right",
        split: "60/40",
        band: {
          container: "wide",
          paddingTop: "3xl",
          paddingBottom: "sm",
          align: "left",
          border: "subtle",
          radius: "lg",
          textTone: "light",
          background: { kind: "solid", color: "#002A3A" },
        },
      },
    });

    const content = saved.content as Record<string, unknown>;
    expect(content["band"]).toMatchObject({
      container: "wide",
      paddingTop: "3xl",
      radius: "lg",
      background: { kind: "solid", color: "#002A3A" },
    });
    expect(resolveGrid(content)).toMatchObject({ desktop: 2, tablet: 2, mobile: 1, gap: "lg" });
  });

  it("refuses a colour that is not a hex", async () => {
    const page = await newPage("Bad colour");
    const section = await pageService.addSection(editor, page.id, "heading");

    await expect(
      pageService.updateSection(editor, section.id, {
        content: {
          text: "Heading",
          band: { background: { kind: "solid", color: "red; background-image: url(x)" } },
        },
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a column count no breakpoint supports", async () => {
    const page = await newPage("Bad grid");
    const section = await pageService.addSection(editor, page.id, "imageCards");

    await expect(
      pageService.updateSection(editor, section.id, {
        content: {
          items: [{ title: "One" }],
          grid: { desktop: 9, tablet: 2, mobile: 1, gap: "md" },
        },
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses an external link in a button", async () => {
    const page = await newPage("Bad link");
    const section = await pageService.addSection(editor, page.id, "textImage");

    await expect(
      pageService.updateSection(editor, section.id, {
        content: { heading: "Heading", ctaLabel: "Go", ctaHref: "https://evil.example.com" },
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("refuses a javascript: URL in a link", async () => {
    const page = await newPage("Script link");
    const section = await pageService.addSection(editor, page.id, "benefits");

    await expect(
      pageService.updateSection(editor, section.id, {
        content: {
          items: [{ icon: "check", title: "One", href: "javascript:alert(1)" }],
        },
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("keeps a section written before the layout controls existed renderable", async () => {
    const page = await newPage("Legacy");
    const section = await pageService.addSection(editor, page.id, "imageCards");

    // Written straight to the column, bypassing the service, exactly as a row
    // stored by the previous version of this code looks.
    await db.pageSection.update({
      where: { id: section.id },
      data: {
        content: {
          heading: "Old cards",
          columns: 2,
          items: [{ title: "One" }, { title: "Two" }],
        },
      },
    });

    const stored = await db.pageSection.findUniqueOrThrow({ where: { id: section.id } });
    const [parsed] = parseSections([
      { id: stored.id, type: stored.type, order: stored.order, content: stored.content },
    ]);

    expect(parsed).toBeDefined();
    expect(parsed!.type).toBe("imageCards");
    // The stored column count still drives the grid; nothing was lost.
    expect(resolveGrid(parsed!.content).desktop).toBe(2);
  });

  it("keeps a hero written before it became a block renderable", async () => {
    const page = await newPage("Legacy hero");
    const section = await db.pageSection.create({
      data: {
        pageId: page.id,
        type: "hero",
        order: 0,
        content: {
          eyebrow: "About",
          heading: "We report on pipeline, not impressions.",
          body: "An agency.",
          ctaLabel: "Start a project",
          ctaHref: "/contact",
          facts: [{ label: "Founded", value: "2019" }],
        },
      },
    });

    const [parsed] = parseSections([
      { id: section.id, type: section.type, order: section.order, content: section.content },
    ]);

    expect(parsed?.type).toBe("hero");
    const content = parsed!.content as Record<string, unknown>;
    expect(content["heading"]).toBe("We report on pipeline, not impressions.");
    // Defaults fill in without the row having said anything about them.
    expect(content["layout"]).toBe("stacked");
    expect(content["height"]).toBe("auto");
  });

  it("hides a card without deleting it", async () => {
    const page = await newPage("Hidden card");
    const section = await pageService.addSection(editor, page.id, "iconCards");

    const saved = await pageService.updateSection(editor, section.id, {
      content: {
        items: [
          { icon: "check", title: "Shown", enabled: true },
          { icon: "check", title: "Hidden", enabled: false },
        ],
      },
    });

    const items = (saved.content as { items: { title: string; enabled: boolean }[] }).items;
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ title: "Hidden", enabled: false });
  });

  it("will not let a reader change a section's layout", async () => {
    const page = await newPage("Permission");
    const section = await pageService.addSection(editor, page.id, "heading");

    await expect(
      pageService.updateSection(reader, section.id, {
        content: { text: "Heading", band: { container: "wide" } },
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("duplicates a section with its layout intact", async () => {
    const page = await newPage("Duplicate");
    const section = await pageService.addSection(editor, page.id, "imageCards");
    await pageService.updateSection(editor, section.id, {
      content: {
        items: [{ title: "One" }],
        grid: { desktop: 4, tablet: 2, mobile: 1, gap: "xl" },
        band: { container: "full", background: { kind: "solid", color: "#FFFFFF" } },
      },
    });

    const copy = await pageService.duplicateSection(editor, section.id);
    const content = copy.content as Record<string, unknown>;
    expect(resolveGrid(content).desktop).toBe(4);
    expect(content["band"]).toMatchObject({ container: "full" });
  });
});
