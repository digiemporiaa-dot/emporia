import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import * as pageService from "@/lib/services/page.service";
import * as reusableService from "@/lib/services/reusable-section.service";
import { ForbiddenError } from "@/lib/errors";
import { ROLE_PERMISSIONS, type RoleNameLiteral } from "@/lib/auth/permissions";
import type { Actor } from "@/lib/actor/types";

/**
 * The CMS permission matrix, exhaustively.
 *
 * Every mutation is called with an actor holding *no* permissions, and must
 * refuse. Written as a table so a new operation added without a check fails
 * here rather than shipping — the failure mode this guards against is not a
 * wrong check, it is a missing one (CLAUDE.md 2 rule 2).
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

function actorWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Matrix",
    email: null,
    type: "STAFF",
    roleName: "STAFF",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

describeDb("CMS permission matrix", () => {
  let god: Actor;
  let nobody: Actor;
  let pageId = "";
  let sectionId = "";
  let reusableId = "";

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    god = actorWith(user.id, [
      "pages.view",
      "pages.create",
      "pages.edit",
      "pages.delete",
      "pages.publish",
      "seo.edit",
      "audit.view",
    ]);
    nobody = actorWith(user.id, []);

    const page = await pageService.createPage(god, { title: "Matrix fixture page" });
    pageId = page.id;
    sectionId = (await pageService.addSection(god, pageId, "heading")).id;

    const reusable = await reusableService.createReusableSection(god, {
      name: "Matrix fixture band",
      type: "cta",
      isGlobal: false,
    });
    reusableId = reusable.id;
  });

  afterAll(async () => {
    if (pageId) await db.page.deleteMany({ where: { id: pageId } });
    if (reusableId) await db.reusableSection.deleteMany({ where: { id: reusableId } });
  });

  const emptySeo = {
    metaTitle: null,
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
    schemaType: "NONE" as const,
  };

  /** [name, the permission it requires, how to call it] */
  const operations: [string, string, (actor: Actor) => Promise<unknown>][] = [
    ["listPages", "pages.view", (a) => pageService.listPages(a, { page: 1, perPage: 10, view: "active" })],
    ["getPage", "pages.view", (a) => pageService.getPage(a, pageId)],
    ["createPage", "pages.create", (a) => pageService.createPage(a, { title: "Refused" })],
    ["updatePage", "pages.edit", (a) => pageService.updatePage(a, pageId, { title: "x", slug: "refused-slug", status: "DRAFT" })],
    ["setPageStatus(publish)", "pages.publish", (a) => pageService.setPageStatus(a, pageId, "PUBLISHED")],
    ["setPageStatus(draft)", "pages.edit", (a) => pageService.setPageStatus(a, pageId, "DRAFT")],
    ["duplicatePage", "pages.create", (a) => pageService.duplicatePage(a, pageId)],
    ["deletePage", "pages.delete", (a) => pageService.deletePage(a, pageId)],
    ["restorePage", "pages.delete", (a) => pageService.restorePage(a, pageId)],
    ["reorderSections", "pages.edit", (a) => pageService.reorderSections(a, pageId, [{ id: sectionId, order: 0 }])],
    ["suggestSlug", "pages.create", (a) => pageService.suggestSlug(a, "Anything")],
    ["addSection", "pages.edit", (a) => pageService.addSection(a, pageId, "heading")],
    ["updateSection", "pages.edit", (a) => pageService.updateSection(a, sectionId, { content: { text: "Heading" } })],
    ["duplicateSection", "pages.edit", (a) => pageService.duplicateSection(a, sectionId)],
    ["setSectionVisible", "pages.edit", (a) => pageService.setSectionVisible(a, sectionId, false)],
    ["deleteSection", "pages.edit", (a) => pageService.deleteSection(a, sectionId)],
    ["updatePageSeo", "seo.edit", (a) => pageService.updatePageSeo(a, pageId, emptySeo)],
    ["issuePreviewToken", "pages.edit", (a) => pageService.issuePreviewToken(a, pageId)],
    ["revokePreviewToken", "pages.edit", (a) => pageService.revokePreviewToken(a, pageId)],
    ["listPageAudit", "audit.view", (a) => pageService.listPageAudit(a, pageId)],
    ["listReusableSections", "pages.view", (a) => reusableService.listReusableSections(a, { page: 1, perPage: 10 })],
    ["getReusableSection", "pages.view", (a) => reusableService.getReusableSection(a, reusableId)],
    ["listInsertable", "pages.edit", (a) => reusableService.listInsertable(a)],
    ["createReusableSection", "pages.create", (a) => reusableService.createReusableSection(a, { name: "Refused band", type: "cta", isGlobal: false })],
    ["updateReusableSection", "pages.edit", (a) => reusableService.updateReusableSection(a, reusableId, { name: "x", status: "DRAFT", isGlobal: false, content: { heading: "Heading", ctaLabel: "Go", ctaHref: "/contact" } })],
    ["deleteReusableSection", "pages.delete", (a) => reusableService.deleteReusableSection(a, reusableId)],
    ["listUsages", "pages.view", (a) => reusableService.listUsages(a, reusableId)],
    ["insertReusableSection", "pages.edit", (a) => reusableService.insertReusableSection(a, pageId, reusableId)],
    ["detachSection", "pages.edit", (a) => reusableService.detachSection(a, sectionId)],
  ];

  it.each(operations)("%s refuses an actor with no permissions", async (_name, _perm, call) => {
    await expect(call(nobody)).rejects.toThrow(ForbiddenError);
  });

  it.each(operations)("%s refuses an actor missing only %s", async (_name, permission, call) => {
    // Everything the operation might want *except* the one it declares. If it
    // is actually checking something else, this passes when it should not —
    // which the "no permissions" case above already rules out.
    const almost = actorWith(
      god.userId,
      [...god.permissions].filter((held) => held !== permission),
    );
    await expect(call(almost)).rejects.toThrow(ForbiddenError);
  });

  it("SUPER_ADMIN bypasses every check without holding a single permission", async () => {
    const superAdmin: Actor = { ...actorWith(god.userId, []), roleName: "SUPER_ADMIN" };
    await expect(
      pageService.listPages(superAdmin, { page: 1, perPage: 5, view: "active" }),
    ).resolves.toBeTruthy();
  });

  it("gives every seeded role that can see pages a coherent set", () => {
    // A role that may create or publish a page but cannot view one would be a
    // dead end in the UI.
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS) as [
      RoleNameLiteral,
      string[],
    ][]) {
      const held = new Set(permissions);
      const writes = ["pages.create", "pages.edit", "pages.delete", "pages.publish"];
      if (writes.some((p) => held.has(p))) {
        expect(held.has("pages.view"), `${role} can write pages but not view them`).toBe(true);
      }
    }
  });
});
