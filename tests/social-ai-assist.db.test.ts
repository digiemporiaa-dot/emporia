import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  assistSocialCopy,
  draftSocialPost,
  generateContentIdeas,
  repurposeContent,
} from "@/lib/services/ai.service";
import { createRepurposedContent } from "@/lib/services/social-repurpose.service";
import { createPillar, saveBrandProfile } from "@/lib/services/social-brand.service";
import { savePost } from "@/lib/services/social-post.service";
import { requestSocialApproval } from "@/lib/services/social-approval.service";
import { approveInternally } from "./support/internal-review";
import { brandProfileSchema } from "@/lib/validation/social-brand";
import { socialPostSchema } from "@/lib/validation/social";
import { textLength } from "@/lib/social/text-length";
import { resetEnvCache } from "@/lib/config/env";
import { startAnthropicDouble, type AnthropicDouble } from "./support/anthropic-double";
import type { Actor } from "@/lib/actor/types";

/**
 * The social AI assists beyond a first caption: adapting one platform's
 * version into another, polishing a caption, repurposing an article, and
 * suggesting ideas.
 *
 * What is pinned is what the brief insists on. Every result is a draft:
 * nothing is written until a person asks, and what repurposing writes is
 * marked as an AI draft that cannot reach the client until a person saves
 * it. Nothing comes from outside the facts given: an article's posts carry
 * the article's link and are fitted to each platform the way the editor
 * counts, a pillar is only ever one of the client's own, and a version to
 * adapt must belong to the same idea.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const SUFFIX = `aia-${Date.now()}`;

function staff(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Writer",
    email: "writer@emporia.test",
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const ALL = ["ai.use", "social.view", "social.create", "social.edit", "social.approve"];
const ARTICLE = `${"Choosing a sofa for a small living room starts with the doorway, not the showroom. ".repeat(6)}Measure twice.`;

describeDb("social AI assists", () => {
  let double: AnthropicDouble;
  let writer: Actor;
  let userId = "";
  let clientA = "";
  let clientB = "";
  let projectA = "";
  let projectB = "";
  let itemId = "";
  let otherItemId = "";
  let blogPostId = "";
  let draftBlogId = "";

  beforeAll(async () => {
    double = await startAnthropicDouble();
    process.env["AI_PROVIDER"] = "anthropic";
    process.env["AI_API_KEY"] = "test-key";
    process.env["AI_BASE_URL"] = double.url;
    resetEnvCache();

    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = user.id;
    writer = staff(user.id, ALL);
    await db.rateLimitWindow.deleteMany({ where: { key: { startsWith: "ai:" }, AND: { key: { contains: user.id } } } });

    const [a, b] = await Promise.all([
      db.client.create({ data: { name: `${SUFFIX} Northwind`, slug: `${SUFFIX}-a`, industry: "Home furniture" }, select: { id: true } }),
      db.client.create({ data: { name: `${SUFFIX} Other`, slug: `${SUFFIX}-b` }, select: { id: true } }),
    ]);
    clientA = a.id;
    clientB = b.id;
    const [pa, pb] = await Promise.all(
      [clientA, clientB].map((clientId, i) =>
        db.project.create({
          data: { code: `${i ? "Q" : "P"}-${SUFFIX}`.slice(0, 20), name: "Retainer", clientId, managerId: user.id, startsAt: new Date(), status: "ACTIVE" },
          select: { id: true },
        }),
      ),
    );
    projectA = pa!.id;
    projectB = pb!.id;

    await saveBrandProfile(writer, clientA, brandProfileSchema.parse({ hashtags: ["northwind"], forbiddenWords: ["cheap"] }));

    const item = await db.contentCalendarItem.create({
      data: { clientId: clientA, projectId: projectA, title: "Small-room sofas", brief: "How to pick a sofa for a small room.", channel: "INSTAGRAM", stage: "DRAFT" },
      select: { id: true },
    });
    itemId = item.id;
    const other = await db.contentCalendarItem.create({
      data: { clientId: clientA, projectId: projectA, title: "Another idea", brief: "x", channel: "INSTAGRAM", stage: "DRAFT" },
      select: { id: true },
    });
    otherItemId = other.id;

    const [published, draft] = await Promise.all([
      db.blogPost.create({
        data: {
          slug: `${SUFFIX}-sofas`,
          title: "The small-room sofa guide",
          excerpt: "Start at the doorway.",
          body: { lead: "Most sofa mistakes happen before you leave home.", sections: [{ heading: "Measure the doorway", text: ARTICLE }] },
          authorId: user.id,
          status: "PUBLISHED",
          publishedAt: new Date(),
        },
        select: { id: true },
      }),
      db.blogPost.create({
        data: { slug: `${SUFFIX}-draft`, title: "Unpublished", body: { lead: ARTICLE }, authorId: user.id, status: "DRAFT" },
        select: { id: true },
      }),
    ]);
    blogPostId = published.id;
    draftBlogId = draft.id;
  });

  afterEach(async () => {
    await db.approval.deleteMany({ where: { contentItem: { clientId: { in: [clientA, clientB] } } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentCalendarItem.deleteMany({
      where: { clientId: { in: [clientA, clientB] }, id: { notIn: [itemId, otherItemId] } },
    });
  });

  afterAll(async () => {
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentPillar.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialBrandProfile.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.blogPost.deleteMany({ where: { id: { in: [blogPostId, draftBlogId] } } });
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
    await double.close();
    delete process.env["AI_BASE_URL"];
    resetEnvCache();
  });

  // -------------------------------------------------------------------------
  // Adapting a version
  // -------------------------------------------------------------------------

  it("creates a LinkedIn version from the Instagram one, telling the model to adapt, not copy", async () => {
    const instagram = await db.socialPost.create({
      data: { contentItemId: itemId, clientId: clientA, provider: "INSTAGRAM", type: "SINGLE_IMAGE", caption: "Measure your doorway before you fall for a sofa.", hashtags: ["homes"] },
      select: { id: true },
    });
    double.reply({ caption: "Before choosing a sofa for a compact living room, measure the doorway.", headline: null, hashtags: [] });

    const draft = await draftSocialPost(writer, { contentItemId: itemId, provider: "LINKEDIN", type: "TEXT", instruction: null, fromPostId: instagram.id });

    const sent = JSON.stringify(double.requests.at(-1));
    expect(sent).toContain("Adapt the existing Instagram version below for LinkedIn");
    expect(sent).toContain("Measure your doorway before you fall for a sofa.");
    expect(draft.data.caption).toMatch(/measure the doorway/);
    // A draft, not a row.
    expect(await db.socialPost.count({ where: { contentItemId: itemId, provider: "LINKEDIN" } })).toBe(0);
  });

  it("only adapts a version of the same idea", async () => {
    const elsewhere = await db.socialPost.create({
      data: { contentItemId: otherItemId, clientId: clientA, provider: "INSTAGRAM", type: "SINGLE_IMAGE", caption: "Other idea's copy." },
      select: { id: true },
    });
    const before = double.requests.length;
    await expect(
      draftSocialPost(writer, { contentItemId: itemId, provider: "LINKEDIN", type: "TEXT", instruction: null, fromPostId: elsewhere.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(double.requests.length).toBe(before);
  });

  // -------------------------------------------------------------------------
  // Polishing
  // -------------------------------------------------------------------------

  it("improves the caption as it stands in the editor, and flags forbidden words", async () => {
    double.reply({ caption: "Not cheap — built for the rooms people actually live in." });
    const draft = await assistSocialCopy(writer, { contentItemId: itemId, provider: "INSTAGRAM", mode: "improve", text: "our sofas fit small rooms", instruction: null });
    expect(draft.task).toBe("assistSocialCopy");
    expect(draft.data.caption).toContain("built for the rooms");
    expect(draft.data.forbiddenUsed).toEqual(["cheap"]);
    expect(JSON.stringify(double.requests.at(-1))).toContain("our sofas fit small rooms");
  });

  it("refuses to improve nothing, before asking the model", async () => {
    const before = double.requests.length;
    await expect(
      assistSocialCopy(writer, { contentItemId: itemId, provider: "INSTAGRAM", mode: "improve", text: "  ", instruction: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(double.requests.length).toBe(before);
  });

  it("suggests hashtags with the brand's own added, and refuses them where the platform has none", async () => {
    double.reply({ hashtags: ["#SmallSpaces", "interiors"] });
    const draft = await assistSocialCopy(writer, { contentItemId: itemId, provider: "INSTAGRAM", mode: "hashtags", text: "x", instruction: null });
    expect(draft.data.hashtags).toEqual(["SmallSpaces", "interiors", "northwind"]);

    await expect(
      assistSocialCopy(writer, { contentItemId: itemId, provider: "GOOGLE_BUSINESS_PROFILE", mode: "hashtags", text: "x", instruction: null }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("picks one of Google's buttons for a Business Profile CTA — and nothing else", async () => {
    double.reply({ callToAction: "BOOK" });
    const draft = await assistSocialCopy(writer, { contentItemId: itemId, provider: "GOOGLE_BUSINESS_PROFILE", mode: "cta", text: "Book a room visit", instruction: null });
    expect(draft.data).toMatchObject({ callToAction: "BOOK" });
    expect(JSON.stringify(double.requests.at(-1))).toContain("LEARN_MORE (Learn more)");

    double.reply({ callToAction: "VISIT_OUR_SHOWROOM" });
    await expect(
      assistSocialCopy(writer, { contentItemId: itemId, provider: "GOOGLE_BUSINESS_PROFILE", mode: "cta", text: "x", instruction: null }),
    ).rejects.toThrow();
  });

  it("writes a closing call-to-action line where a platform has no buttons", async () => {
    double.reply({ ctaLine: "Measure tonight, visit us this weekend." });
    const draft = await assistSocialCopy(writer, { contentItemId: itemId, provider: "LINKEDIN", mode: "cta", text: "x", instruction: null });
    expect(draft.data).toMatchObject({ ctaLine: "Measure tonight, visit us this weekend." });
  });

  // -------------------------------------------------------------------------
  // Repurposing
  // -------------------------------------------------------------------------

  const targets = [
    { provider: "LINKEDIN" as const, type: "LINK" },
    { provider: "X" as const, type: "TEXT" },
    { provider: "GOOGLE_BUSINESS_PROFILE" as const, type: "GBP_POST" },
  ];

  it("repurposes a published article: its words, its link, each platform fitted the way the editor counts", async () => {
    double.reply({
      versions: [
        { provider: "LINKEDIN", caption: "Most sofa mistakes happen before you leave home.", headline: null, hashtags: ["interiors"] },
        // Far too long for X once the link and hashtags ride along.
        { provider: "X", caption: "Measure the doorway first. ".repeat(20), headline: null, hashtags: ["sofas"] },
        { provider: "GOOGLE_BUSINESS_PROFILE", caption: "Planning a new sofa? Start with the doorway.", headline: null, hashtags: ["ignored"] },
      ],
      carouselSlides: ["Measure the doorway", "Then the room"],
      videoScript: "Open on a tape measure.",
    });

    const before = await db.contentCalendarItem.count({ where: { clientId: clientA } });
    const draft = await repurposeContent(writer, {
      clientId: clientA, pillarId: null, source: { kind: "blog", blogPostId }, targets, carousel: true, videoScript: false, instruction: null,
    });

    const sent = JSON.stringify(double.requests.at(-1));
    expect(sent).toContain("Measure the doorway");
    expect(sent).toContain("The small-room sofa guide");
    expect(draft.data.sourceBlogPostId).toBe(blogPostId);
    expect(draft.data.sourceUrl).toMatch(new RegExp(`/blog/${SUFFIX}-sofas$`));

    const x = draft.data.versions.find((v) => v.provider === "X")!;
    expect(x.linkUrl).toBe(draft.data.sourceUrl);
    // Exactly the editor's rule: this version saves.
    expect(socialPostSchema.safeParse({ contentItemId: "i", provider: "X", type: "TEXT", caption: x.caption, hashtags: x.hashtags, linkUrl: x.linkUrl }).success).toBe(true);
    expect(textLength([x.caption, ...x.hashtags.map((t) => `#${t}`), x.linkUrl!].join(" "), "x-weighted")).toBeLessThanOrEqual(280);

    // Fields a platform lacks are dropped, brand tags added where it has them.
    expect(draft.data.versions.find((v) => v.provider === "GOOGLE_BUSINESS_PROFILE")!.hashtags).toEqual([]);
    expect(draft.data.versions.find((v) => v.provider === "LINKEDIN")!.hashtags).toEqual(["interiors", "northwind"]);
    expect(draft.data.carouselSlides).toEqual(["Measure the doorway", "Then the room"]);
    // Asked for no script, so none — whatever came back.
    expect(draft.data.videoScript).toBeNull();
    // A draft: nothing written.
    expect(await db.contentCalendarItem.count({ where: { clientId: clientA } })).toBe(before);
  });

  it("drops a platform the model skipped rather than inventing a post for it", async () => {
    double.reply({ versions: [{ provider: "LINKEDIN", caption: "Only this one.", headline: null, hashtags: [] }], carouselSlides: null, videoScript: null });
    const draft = await repurposeContent(writer, {
      clientId: clientA, pillarId: null, source: { kind: "text", title: "Sofas", text: ARTICLE, url: null }, targets, carousel: false, videoScript: false, instruction: null,
    });
    expect(draft.data.versions.map((v) => v.provider)).toEqual(["LINKEDIN"]);
    expect(draft.data.versions[0]!.linkUrl).toBeNull();
  });

  it("refuses an unpublished article, a scrap of text, and a format a platform lacks — before asking the model", async () => {
    const before = double.requests.length;
    await expect(
      repurposeContent(writer, { clientId: clientA, pillarId: null, source: { kind: "blog", blogPostId: draftBlogId }, targets, carousel: false, videoScript: false, instruction: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      repurposeContent(writer, { clientId: clientA, pillarId: null, source: { kind: "text", title: "Short", text: "Too short.", url: null }, targets, carousel: false, videoScript: false, instruction: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      repurposeContent(writer, { clientId: clientA, pillarId: null, source: { kind: "text", title: "T", text: ARTICLE, url: null }, targets: [{ provider: "INSTAGRAM", type: "TEXT" }], carousel: false, videoScript: false, instruction: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(double.requests.length).toBe(before);
  });

  // -------------------------------------------------------------------------
  // Turning a reviewed draft into content
  // -------------------------------------------------------------------------

  const versions = [
    { provider: "LINKEDIN" as const, type: "LINK", caption: "Most sofa mistakes happen before you leave home.", headline: null, hashtags: ["interiors"], linkUrl: "https://northwind.test/blog/sofas" },
    { provider: "GOOGLE_BUSINESS_PROFILE" as const, type: "GBP_POST", caption: "Start with the doorway.", headline: null, hashtags: [], linkUrl: "https://northwind.test/blog/sofas" },
  ];

  it("creates one idea with a version per platform, each marked as an AI draft, linked to the article", async () => {
    const item = await createRepurposedContent(writer, {
      clientId: clientA, projectId: projectA, campaignId: null, pillarId: null, title: "The small-room sofa guide", brief: "Repurposed.", sourceBlogPostId: blogPostId, versions,
    });
    const row = await db.contentCalendarItem.findUniqueOrThrow({
      where: { id: item.id },
      select: { sourceBlogPostId: true, stage: true, socialPosts: { select: { provider: true, status: true, aiDraftedAt: true } } },
    });
    expect(row.sourceBlogPostId).toBe(blogPostId);
    expect(row.stage).toBe("DRAFT");
    expect(row.socialPosts).toHaveLength(2);
    expect(row.socialPosts.every((p) => p.status === "DRAFT" && p.aiDraftedAt !== null)).toBe(true);
  });

  it("will not send an unreviewed AI draft to the client, and will once a person has saved it", async () => {
    const item = await createRepurposedContent(writer, {
      clientId: clientA, projectId: projectA, campaignId: null, pillarId: null, title: "Review me", brief: null, sourceBlogPostId: null, versions: versions.slice(0, 1),
    });
    // Through internal review first, as the workflow requires.
    await db.contentCalendarItem.update({ where: { id: item.id }, data: { stage: "INTERNAL_REVIEW" } });
    await expect(requestSocialApproval(writer, { contentItemId: item.id, note: null })).rejects.toThrow(/unreviewed AI draft/);

    // A person opens it and saves it — their name is on it now.
    const post = await db.socialPost.findFirstOrThrow({ where: { contentItemId: item.id }, select: { id: true } });
    await savePost(writer, post.id, socialPostSchema.parse({ ...versions[0], contentItemId: item.id }));
    expect((await db.socialPost.findUniqueOrThrow({ where: { id: post.id }, select: { aiDraftedAt: true } })).aiDraftedAt).toBeNull();
    await approveInternally(item.id, userId);
    await expect(requestSocialApproval(writer, { contentItemId: item.id, note: null })).resolves.toBeDefined();
  });

  it("checks every version before writing anything, so a bad one leaves nothing behind", async () => {
    const before = await db.contentCalendarItem.count({ where: { clientId: clientA } });
    await expect(
      createRepurposedContent(writer, {
        clientId: clientA, projectId: projectA, campaignId: null, pillarId: null, title: "Broken", brief: null, sourceBlogPostId: null,
        versions: [...versions, { provider: "X" as const, type: "TEXT", caption: "x".repeat(300), headline: null, hashtags: [], linkUrl: null }],
      }),
    ).rejects.toThrow(/The X version/);
    expect(await db.contentCalendarItem.count({ where: { clientId: clientA } })).toBe(before);
  });

  it("files nothing under another client's project, and a portal user cannot repurpose at all", async () => {
    await expect(
      createRepurposedContent(writer, { clientId: clientA, projectId: projectB, campaignId: null, pillarId: null, title: "Cross", brief: null, sourceBlogPostId: null, versions }),
    ).rejects.toBeInstanceOf(ValidationError);
    const portal: Actor = { ...writer, type: "CLIENT", roleName: "CLIENT_USER", clientId: clientB, permissions: new Set(["social.view"]) };
    await expect(
      createRepurposedContent(portal, { clientId: clientB, projectId: projectB, campaignId: null, pillarId: null, title: "Portal", brief: null, sourceBlogPostId: null, versions }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // -------------------------------------------------------------------------
  // Ideas
  // -------------------------------------------------------------------------

  it("suggests ideas, keeps pillars to the client's own, skips repeats, and creates nothing", async () => {
    const stories = await createPillar(writer, clientA, { name: "Customer stories", description: null });
    double.reply({
      ideas: [
        { title: "A family's first sofa", brief: "Follow one family choosing.", pillar: "customer stories" },
        { title: "Small-room sofas", brief: "Repeat of an existing idea.", pillar: null },
        { title: "Doorway myths", brief: "Common measuring mistakes.", pillar: "Viral Trends" },
      ],
    });
    const before = await db.contentCalendarItem.count({ where: { clientId: clientA } });

    const draft = await generateContentIdeas(writer, { clientId: clientA, campaignId: null, pillarId: null, count: 5, instruction: null });

    expect(draft.data.ideas.map((i) => i.title)).toEqual(["A family's first sofa", "Doorway myths"]);
    expect(draft.data.ideas[0]).toMatchObject({ pillarId: stories.id, pillarName: "Customer stories" });
    // A pillar the model made up is no pillar.
    expect(draft.data.ideas[1]).toMatchObject({ pillarId: null, pillarName: null });
    expect(JSON.stringify(double.requests.at(-1))).toContain("Recent ideas, not to repeat");
    expect(await db.contentCalendarItem.count({ where: { clientId: clientA } })).toBe(before);
  });

  it("refuses another client's campaign for ideas", async () => {
    const campaign = await db.campaign.create({
      data: { name: `${SUFFIX} B campaign`, clientId: clientB, platform: "SOCIAL_ORGANIC", ownerId: userId, startsAt: new Date() },
      select: { id: true },
    });
    try {
      await expect(
        generateContentIdeas(writer, { clientId: clientA, campaignId: campaign.id, pillarId: null, count: 5, instruction: null }),
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      await db.campaign.delete({ where: { id: campaign.id } });
    }
  });

  it("needs ai.use for every assist", async () => {
    const noAi = staff(userId, ["social.view", "social.create", "social.edit"]);
    await expect(assistSocialCopy(noAi, { contentItemId: itemId, provider: "INSTAGRAM", mode: "improve", text: "x", instruction: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(generateContentIdeas(noAi, { clientId: clientA, campaignId: null, pillarId: null, count: 3, instruction: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      repurposeContent(noAi, { clientId: clientA, pillarId: null, source: { kind: "text", title: "T", text: ARTICLE, url: null }, targets, carousel: false, videoScript: false, instruction: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
