import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as pageService from "@/lib/services/page.service";
import { ForbiddenError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";

/**
 * Page CMS service, against the real database.
 *
 * The service is where the CMS's rules actually live — the admin screens only
 * call into it — so this is where they are pinned. Authorization in particular:
 * hiding a button is not a control (CLAUDE.md 2 rule 2), and these assert that
 * the *service* refuses, not the UI.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

function actorWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Test editor",
    email: "editor@emporia.test",
    type: "STAFF",
    roleName: "CONTENT_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

describeDb("page CMS service", () => {
  const created: string[] = [];
  let editor: Actor;
  let viewer: Actor;

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true },
    });
    editor = actorWith(user.id, [
      "pages.view",
      "pages.create",
      "pages.edit",
      "pages.delete",
      "pages.publish",
    ]);
    viewer = actorWith(user.id, ["pages.view"]);
  });

  afterAll(async () => {
    if (created.length > 0) {
      await db.page.deleteMany({ where: { id: { in: created } } });
    }
  });

  const track = <T extends { id: string }>(row: T): T => {
    created.push(row.id);
    return row;
  };

  it("refuses to list for an actor without pages.view", async () => {
    const nobody = actorWith(editor.userId, []);
    await expect(pageService.listPages(nobody, { page: 1, perPage: 25, view: "active" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("derives a slug from the title and keeps it unique", async () => {
    const first = track(await pageService.createPage(editor, { title: "Autumn Offer" }));
    const second = track(await pageService.createPage(editor, { title: "Autumn Offer" }));

    expect(first.slug).toBe("autumn-offer");
    expect(second.slug).toBe("autumn-offer-2");
    expect(first.status).toBe("DRAFT");
  });

  it("refuses a slug that would be shadowed by a built-in route", async () => {
    await expect(
      pageService.createPage(editor, { title: "Services", slug: "services" }),
    ).rejects.toThrow(/built-in page/i);
  });

  it("lets a page keep a reserved slug it already holds", async () => {
    // `home`, `about` and the legal pages ARE CMS pages whose slugs match a
    // bespoke route, and the route reads their sections by that slug. Applying
    // the reserved-slug rule to an unchanged slug made every one of them
    // unsavable — an edit to an untouched field failed on the slug.
    const page = track(await pageService.createPage(editor, { title: "Holds a reserved slug" }));
    await db.page.update({ where: { id: page.id }, data: { slug: "about-us-temp" } });
    await db.page.update({ where: { id: page.id }, data: { slug: "careers" } });

    await expect(
      pageService.updatePage(editor, page.id, {
        title: "Careers",
        slug: "careers",
        status: "DRAFT",
        internalName: "edited",
      }),
    ).resolves.toBeTruthy();
  });

  it("still refuses to move a page onto a reserved slug", async () => {
    const page = track(await pageService.createPage(editor, { title: "Moving onto reserved" }));

    await expect(
      pageService.updatePage(editor, page.id, {
        title: "Moving onto reserved",
        slug: "blog",
        status: "DRAFT",
      }),
    ).rejects.toThrow(/built-in page/i);
  });

  it("names the offending field on a slug conflict, so the form can mark it", async () => {
    const first = track(await pageService.createPage(editor, { title: "Slug conflict a" }));
    const second = track(await pageService.createPage(editor, { title: "Slug conflict b" }));

    await expect(
      pageService.updatePage(editor, second.id, {
        title: "Slug conflict b",
        slug: first.slug,
        status: "DRAFT",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", details: { slug: expect.any(Array) } });
  });

  it("will not let an editor without pages.publish publish", async () => {
    const page = track(await pageService.createPage(editor, { title: "Needs approval" }));
    const editorNoPublish = actorWith(editor.userId, ["pages.view", "pages.edit"]);

    await expect(pageService.setPageStatus(editorNoPublish, page.id, "PUBLISHED")).rejects.toThrow(
      ForbiddenError,
    );
    // The same actor may still move it back to draft — that is an edit.
    await expect(
      pageService.setPageStatus(editorNoPublish, page.id, "DRAFT"),
    ).resolves.toBeTruthy();
  });

  it("stamps publishedAt once and does not rewrite it on republish", async () => {
    const page = track(await pageService.createPage(editor, { title: "Publish once" }));

    const published = await pageService.setPageStatus(editor, page.id, "PUBLISHED");
    expect(published.publishedAt).not.toBeNull();

    await pageService.setPageStatus(editor, page.id, "DRAFT");
    const again = await pageService.setPageStatus(editor, page.id, "PUBLISHED");
    expect(again.publishedAt?.getTime()).toBe(published.publishedAt?.getTime());
  });

  it("duplicates as a draft with its own slug, copying sections", async () => {
    const source = track(await pageService.createPage(editor, { title: "Campaign source" }));
    await db.pageSection.createMany({
      data: [
        { pageId: source.id, type: "prose", order: 0, content: { paragraphs: ["One"] } },
        { pageId: source.id, type: "prose", order: 1, content: { paragraphs: ["Two"] }, isVisible: false },
      ],
    });
    await pageService.setPageStatus(editor, source.id, "PUBLISHED");

    const copy = track(await pageService.duplicatePage(editor, source.id));
    const full = await pageService.getPage(editor, copy.id);

    expect(copy.slug).toBe("campaign-source-copy");
    // Never a second live page by accident.
    expect(full.status).toBe("DRAFT");
    expect(full.sections).toHaveLength(2);
    expect(full.sections[1]?.isVisible).toBe(false);
    // SEO is not copied: two pages sharing a canonical is the defect a
    // duplicate button would otherwise mass-produce.
    expect(full.seoId).toBeNull();
  });

  it("soft-deletes: gone from the list, present in the bin, restorable", async () => {
    const page = track(await pageService.createPage(editor, { title: "Temporary page" }));

    await pageService.deletePage(editor, page.id);

    const active = await pageService.listPages(editor, {
      page: 1,
      perPage: 100,
      view: "active",
      query: "Temporary page",
    });
    expect(active.rows.find((r) => r.id === page.id)).toBeUndefined();

    const bin = await pageService.listPages(editor, {
      page: 1,
      perPage: 100,
      view: "deleted",
      query: "Temporary page",
    });
    expect(bin.rows.find((r) => r.id === page.id)).toBeDefined();

    const restored = await pageService.restorePage(editor, page.id);
    expect(restored.deletedAt).toBeNull();
    expect(restored.status).toBe("DRAFT");
  });

  it("refuses to delete for an actor holding only pages.view", async () => {
    const page = track(await pageService.createPage(editor, { title: "Not yours to delete" }));
    await expect(pageService.deletePage(viewer, page.id)).rejects.toThrow(ForbiddenError);
  });

  it("scopes a reorder to its own page, so a foreign section id cannot be moved in", async () => {
    const mine = track(await pageService.createPage(editor, { title: "Reorder mine" }));
    const other = track(await pageService.createPage(editor, { title: "Reorder other" }));

    const [a, b] = await Promise.all([
      db.pageSection.create({
        data: { pageId: mine.id, type: "prose", order: 0, content: { paragraphs: ["A"] } },
        select: { id: true },
      }),
      db.pageSection.create({
        data: { pageId: other.id, type: "prose", order: 0, content: { paragraphs: ["B"] } },
        select: { id: true },
      }),
    ]);

    await pageService.reorderSections(editor, mine.id, [
      { id: a.id, order: 5 },
      { id: b.id, order: 9 },
    ]);

    const moved = await db.pageSection.findUniqueOrThrow({ where: { id: a.id } });
    const untouched = await db.pageSection.findUniqueOrThrow({ where: { id: b.id } });
    expect(moved.order).toBe(5);
    expect(untouched.order).toBe(0);
  });

  it("records the create against the page's id, so its history is findable", async () => {
    // Keyed to the slug, the create row vanished from the page's history and
    // went stale the moment the page was renamed.
    const page = track(await pageService.createPage(editor, { title: "Audited create" }));

    const entries = await db.auditLog.findMany({
      where: { entityType: "Page", entityId: page.id, action: "CREATE" },
      select: { id: true },
    });
    expect(entries.length).toBe(1);

    await pageService.updatePage(editor, page.id, {
      title: "Audited create renamed",
      slug: "audited-create-renamed",
      status: "DRAFT",
    });

    const trail = await pageService.listPageAudit(
      { ...editor, permissions: new Set([...editor.permissions, "audit.view"]) },
      page.id,
    );
    expect(trail.map((row) => row.action)).toEqual(expect.arrayContaining(["CREATE", "UPDATE"]));
  });

  it("writes an audit row for a publish", async () => {
    const page = track(await pageService.createPage(editor, { title: "Audited page" }));
    await pageService.setPageStatus(editor, page.id, "PUBLISHED");

    const entries = await db.auditLog.findMany({
      where: { entityType: "Page", entityId: page.id, action: "PUBLISH" },
      select: { id: true },
    });
    expect(entries.length).toBeGreaterThan(0);
  });
  it("creates the SEO record on first save and updates it thereafter", async () => {
    const page = track(await pageService.createPage(editor, { title: "Seo lifecycle" }));
    const seoEditor = actorWith(editor.userId, ["pages.view", "seo.edit"]);

    const first = await pageService.updatePageSeo(seoEditor, page.id, {
      metaTitle: "First title",
      metaDescription: null,
      canonical: null,
      targetKeyword: null,
      ogTitle: null,
      ogDescription: null,
      ogImageId: null,
      ogImageAlt: null,
      twitterTitle: null,
      twitterDescription: null,
      twitterImageId: null,
      robotsIndex: true,
      robotsFollow: true,
      schemaType: "NONE",
    });
    expect(first.seo?.metaTitle).toBe("First title");
    const seoId = first.seoId;
    expect(seoId).not.toBeNull();

    const second = await pageService.updatePageSeo(seoEditor, page.id, {
      metaTitle: "Second title",
      metaDescription: "A description.",
      canonical: null,
      targetKeyword: null,
      ogTitle: null,
      ogDescription: null,
      ogImageId: null,
      ogImageAlt: null,
      twitterTitle: null,
      twitterDescription: null,
      twitterImageId: null,
      robotsIndex: false,
      robotsFollow: true,
      schemaType: "FAQ_PAGE",
    });
    // Updated in place rather than a second row orphaning the first.
    expect(second.seoId).toBe(seoId);
    expect(second.seo?.metaTitle).toBe("Second title");
    expect(second.seo?.robotsIndex).toBe(false);
    expect(second.seo?.schemaType).toBe("FAQ_PAGE");
  });

  it("gates SEO on seo.edit, not on pages.edit", async () => {
    const page = track(await pageService.createPage(editor, { title: "Seo permission" }));
    const contentOnly = actorWith(editor.userId, ["pages.view", "pages.edit"]);

    await expect(
      pageService.updatePageSeo(contentOnly, page.id, {
        metaTitle: "Nope",
        metaDescription: null,
        canonical: null,
        targetKeyword: null,
        ogTitle: null,
        ogDescription: null,
        ogImageId: null,
        ogImageAlt: null,
        twitterTitle: null,
        twitterDescription: null,
        twitterImageId: null,
        robotsIndex: true,
        robotsFollow: true,
        schemaType: "NONE",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("issues a preview token that resolves, and stops resolving once revoked", async () => {
    const page = track(await pageService.createPage(editor, { title: "Preview token" }));

    const token = await pageService.issuePreviewToken(editor, page.id);
    expect(token.length).toBeGreaterThanOrEqual(40);

    const resolved = await pageService.getPageByPreviewToken(token);
    expect(resolved?.id).toBe(page.id);

    // Rotating invalidates the previous link, which is how sharing is undone.
    const rotated = await pageService.issuePreviewToken(editor, page.id);
    expect(rotated).not.toBe(token);
    expect(await pageService.getPageByPreviewToken(token)).toBeNull();

    await pageService.revokePreviewToken(editor, page.id);
    expect(await pageService.getPageByPreviewToken(rotated)).toBeNull();
  });

  it("will not resolve a preview token for a deleted page, or a junk one", async () => {
    const page = track(await pageService.createPage(editor, { title: "Preview deleted" }));
    const token = await pageService.issuePreviewToken(editor, page.id);
    await pageService.deletePage(editor, page.id);

    expect(await pageService.getPageByPreviewToken(token)).toBeNull();
    expect(await pageService.getPageByPreviewToken("")).toBeNull();
    expect(await pageService.getPageByPreviewToken("short")).toBeNull();
  });

  it("excludes hidden sections from what a shared preview shows", async () => {
    const page = track(await pageService.createPage(editor, { title: "Preview hidden" }));
    await pageService.addSection(editor, page.id, "heading");
    const hidden = await pageService.addSection(editor, page.id, "richText");
    await pageService.setSectionVisible(editor, hidden.id, false);

    const token = await pageService.issuePreviewToken(editor, page.id);
    const resolved = await pageService.getPageByPreviewToken(token);
    expect(resolved?.sections).toHaveLength(1);
  });
});
