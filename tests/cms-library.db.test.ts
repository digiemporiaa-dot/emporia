import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { searchContent, searchableTypes } from "@/lib/services/cms-search.service";
import { bulkSetState, BULK_LIMIT } from "@/lib/services/cms-bulk.service";
import { CONTENT_REGISTRY, CONTENT_TYPES } from "@/lib/cms/registry";
import type { Actor } from "@/lib/actor/types";

/**
 * The content library.
 *
 * Two things have to be true. Search must never show a record the actor is not
 * allowed to see — not hidden afterwards, not queried at all. And bulk actions
 * must go through each type's own path, so a record that its own screen would
 * refuse is refused here too, with its own reason.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `lib-${Date.now()}`;

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

describeDb("content library", () => {
  const pages: string[] = [];
  const posts: string[] = [];
  const studies: string[] = [];
  let everything: Actor;
  let pagesOnly: Actor;

  beforeAll(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    everything = actorWith(staff.id, [
      ...CONTENT_TYPES.flatMap((type) => [
        CONTENT_REGISTRY[type].viewPermission,
        CONTENT_REGISTRY[type].editPermission,
        CONTENT_REGISTRY[type].publishPermission,
      ]),
    ]);
    pagesOnly = actorWith(staff.id, ["pages.view", "pages.edit", "pages.publish"]);
  });

  afterAll(async () => {
    await db.pageSection.deleteMany({ where: { pageId: { in: pages } } });
    await db.page.deleteMany({ where: { id: { in: pages } } });
    await db.blogPost.deleteMany({ where: { id: { in: posts } } });
    await db.caseStudy.deleteMany({ where: { id: { in: studies } } });
  });

  async function newPage(title: string, status: "DRAFT" | "PUBLISHED" = "DRAFT") {
    const page = await db.page.create({
      data: {
        slug: `lib-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        status,
        sections: { create: [{ type: "richText", order: 0, content: { body: "Words." } }] },
      },
      select: { id: true },
    });
    pages.push(page.id);
    return page.id;
  }

  async function newPost(title: string) {
    const author = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    const seo = await db.seo.create({ data: {}, select: { id: true } });
    const post = await db.blogPost.create({
      data: {
        slug: `post-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        body: {},
        authorId: author.id,
        seoId: seo.id,
        status: "DRAFT",
      },
      select: { id: true },
    });
    posts.push(post.id);
    return post.id;
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  it("finds a page by its title across every type", async () => {
    const id = await newPage(`Findable ${SUFFIX}`);
    const result = await searchContent(everything, {
      query: `Findable ${SUFFIX}`,
      page: 1,
      perPage: 25,
    });
    expect(result.rows.map((row) => row.id)).toContain(id);
    expect(result.rows.find((row) => row.id === id)?.type).toBe("page");
  });

  it("finds a blog post and a page in one search, sorted by what changed last", async () => {
    const pageId = await newPage(`Shared word ${SUFFIX}`);
    const postId = await newPost(`Shared word ${SUFFIX}`);

    const result = await searchContent(everything, {
      query: `Shared word ${SUFFIX}`,
      page: 1,
      perPage: 25,
    });
    const types = result.rows.map((row) => row.type);
    expect(types).toContain("page");
    expect(types).toContain("blogPost");
    // The post was created after the page, so it sorts first.
    expect(result.rows[0]?.id).toBe(postId);
    expect(result.rows.map((row) => row.id)).toContain(pageId);
  });

  it("never queries a type the actor may not see", async () => {
    await newPost(`Hidden ${SUFFIX}`);
    await newPage(`Hidden ${SUFFIX}`);

    const result = await searchContent(pagesOnly, {
      query: `Hidden ${SUFFIX}`,
      page: 1,
      perPage: 25,
    });
    expect(result.rows.every((row) => row.type === "page" || row.type === "reusableSection")).toBe(
      true,
    );
    expect(result.available).not.toContain("blogPost");
  });

  it("refuses to widen a type filter the actor cannot see", async () => {
    // Asking for blog posts without blog.view returns nothing, rather than
    // falling back to everything.
    await newPost(`Narrow ${SUFFIX}`);
    const result = await searchContent(pagesOnly, {
      query: `Narrow ${SUFFIX}`,
      type: "blogPost",
      page: 1,
      perPage: 25,
    });
    expect(result.rows).toHaveLength(0);
  });

  it("filters by state", async () => {
    const draft = await newPage(`Stateful ${SUFFIX}`);
    const live = await newPage(`Stateful ${SUFFIX}`, "PUBLISHED");

    const published = await searchContent(everything, {
      query: `Stateful ${SUFFIX}`,
      state: "PUBLISHED",
      page: 1,
      perPage: 25,
    });
    const ids = published.rows.map((row) => row.id);
    expect(ids).toContain(live);
    expect(ids).not.toContain(draft);
  });

  it("matches nothing when a state a type cannot be in is asked for", async () => {
    // Cities are on or off; there is no archived city, so asking for one is
    // empty rather than everything.
    const result = await searchContent(everything, { type: "city", state: "ARCHIVED", page: 1, perPage: 25 });
    expect(result.rows).toHaveLength(0);
  });

  it("counts what each type contributed", async () => {
    await newPage(`Counted ${SUFFIX}`);
    await newPage(`Counted ${SUFFIX}`);
    const result = await searchContent(everything, {
      query: `Counted ${SUFFIX}`,
      page: 1,
      perPage: 25,
    });
    expect(result.countsByType.page).toBe(2);
  });

  it("lists only the types this actor may search", () => {
    expect(searchableTypes(pagesOnly).sort()).toEqual(["page", "reusableSection"]);
  });

  // -------------------------------------------------------------------------
  // Bulk
  // -------------------------------------------------------------------------

  it("publishes a selection that spans two types", async () => {
    const pageId = await newPage(`Bulk ${SUFFIX}`);
    const postId = await newPost(`Bulk ${SUFFIX}`);

    const outcome = await bulkSetState(
      everything,
      [
        { type: "page", id: pageId },
        { type: "blogPost", id: postId },
      ],
      "publish",
    );

    expect(outcome.failed).toHaveLength(0);
    expect(outcome.changed).toHaveLength(2);
    expect(
      (await db.page.findUniqueOrThrow({ where: { id: pageId }, select: { status: true } })).status,
    ).toBe("PUBLISHED");
    expect(
      (await db.blogPost.findUniqueOrThrow({ where: { id: postId }, select: { status: true } }))
        .status,
    ).toBe("PUBLISHED");
  });

  it("goes through the real publish path, so a version is taken", async () => {
    const pageId = await newPage(`Versioned ${SUFFIX}`);
    await bulkSetState(everything, [{ type: "page", id: pageId }], "publish");

    const versions = await db.pageVersion.count({ where: { pageId } });
    expect(versions).toBe(1);
  });

  it("audits each record, not the batch", async () => {
    const first = await newPage(`Audited ${SUFFIX}`);
    const second = await newPage(`Audited ${SUFFIX}`);
    await bulkSetState(
      everything,
      [
        { type: "page", id: first },
        { type: "page", id: second },
      ],
      "publish",
    );

    const entries = await db.auditLog.count({
      where: { entityType: "Page", entityId: { in: [first, second] }, action: "PUBLISH" },
    });
    expect(entries).toBe(2);
  });

  it("carries on past a refusal and reports which one refused, and why", async () => {
    const ok = await newPage(`Partial ${SUFFIX}`);

    const outcome = await bulkSetState(
      everything,
      [
        { type: "page", id: ok },
        { type: "page", id: "cdoesnotexist00000000000" },
      ],
      "publish",
    );

    expect(outcome.changed.map((row) => row.id)).toEqual([ok]);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]?.id).toBe("cdoesnotexist00000000000");
    // The record's own error, not a generic "failed".
    expect(outcome.failed[0]?.reason).toMatch(/does not exist/i);
  });

  it("refuses a state the type cannot be in, with a reason", async () => {
    const city = await db.city.findFirst({ select: { id: true } });
    if (!city) return;

    const outcome = await bulkSetState(everything, [{ type: "city", id: city.id }], "archive");
    expect(outcome.changed).toHaveLength(0);
    expect(outcome.failed[0]?.reason).toMatch(/cannot be archived/i);
  });

  it("refuses everything the actor lacks permission for, one row at a time", async () => {
    const pageId = await newPage(`Denied ${SUFFIX}`);
    const viewer = actorWith(everything.userId, ["pages.view"]);

    const outcome = await bulkSetState(viewer, [{ type: "page", id: pageId }], "publish");
    expect(outcome.changed).toHaveLength(0);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]?.reason).toMatch(/permission/i);
  });

  it("caps a runaway selection rather than issuing thousands of queries", async () => {
    const targets = Array.from({ length: BULK_LIMIT + 3 }, (_, i) => ({
      type: "page" as const,
      id: `cfake${String(i).padStart(19, "0")}`,
    }));

    const outcome = await bulkSetState(everything, targets, "publish");
    expect(outcome.failed).toHaveLength(BULK_LIMIT + 3);
    expect(outcome.failed.at(-1)?.reason).toMatch(new RegExp(`Only ${BULK_LIMIT} at a time`));
  });
});

describe("content registry", () => {
  it("gives every type a label, permissions and at least two states", () => {
    for (const type of CONTENT_TYPES) {
      const meta = CONTENT_REGISTRY[type];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.plural.length).toBeGreaterThan(0);
      expect(meta.viewPermission).toMatch(/\./);
      expect(meta.states.length).toBeGreaterThanOrEqual(2);
      expect(meta.href("abc")).toMatch(/^\/admin\//);
    }
  });

  it("always allows published and draft, whatever the underlying column is", () => {
    for (const type of CONTENT_TYPES) {
      expect(CONTENT_REGISTRY[type].states).toContain("PUBLISHED");
      expect(CONTENT_REGISTRY[type].states).toContain("DRAFT");
    }
  });
});
