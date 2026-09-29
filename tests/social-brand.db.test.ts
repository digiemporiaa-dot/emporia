import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  activePillars,
  createPillar,
  getBrandKit,
  movePillar,
  postingThisWeek,
  saveBrandProfile,
  saveStrategy,
  setPillarArchived,
  updatePillar,
} from "@/lib/services/social-brand.service";
import {
  createSocialContent,
  listContentItems,
  setContentPillar,
} from "@/lib/services/social-content.service";
import { calendarPosts } from "@/lib/services/social-calendar.service";
import { draftSocialPost, forbiddenWordsIn } from "@/lib/services/ai.service";
import { brandProfileSchema, strategySchema } from "@/lib/validation/social-brand";
import { resetEnvCache } from "@/lib/config/env";
import { startAnthropicDouble, type AnthropicDouble } from "./support/anthropic-double";
import type { Actor } from "@/lib/actor/types";

/**
 * Brand profile, content pillars and social strategy.
 *
 * Three things are pinned. Isolation: a pillar, a profile or a strategy is
 * one client's, and nothing typed into a form moves content into another
 * client's pillar. Consumption: the AI drafting reads the brand kit, adds the
 * brand's hashtags, and flags forbidden words rather than trusting the model
 * to obey. Honesty: the strategy stores targets, and the only comparison is a
 * count of posts that really exist.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const SUFFIX = `brand-${Date.now()}`;

function staff(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Strategist",
    email: "strategist@emporia.test",
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

function portalUser(userId: string, clientId: string): Actor {
  return { ...staff(userId, ["social.view", "social.edit"]), type: "CLIENT", roleName: "CLIENT_USER", clientId };
}

const EDITOR = ["social.view", "social.create", "social.edit", "ai.use"];

describe("normalising what a person types", () => {
  it("stores hashtags bare, drops duplicates in any case, and keeps colours to hex", () => {
    const parsed = brandProfileSchema.parse({
      hashtags: ["#Northwind", "northwind", "##Festive"],
      forbiddenWords: ["cheap", "Cheap", " "],
      brandColors: ["#DF1F38"],
    });
    expect(parsed.hashtags).toEqual(["Northwind", "Festive"]);
    expect(parsed.forbiddenWords).toEqual(["cheap"]);
    expect(brandProfileSchema.safeParse({ brandColors: ["red"] }).success).toBe(false);
  });

  it("keeps a posting frequency only for platforms the strategy uses", () => {
    const parsed = strategySchema.parse({
      platforms: ["INSTAGRAM"],
      postingFrequency: { INSTAGRAM: "4", LINKEDIN: 2, NOT_A_PLATFORM: 9 },
    });
    expect(parsed.postingFrequency).toEqual({ INSTAGRAM: 4 });
  });
});

describe("spotting forbidden words", () => {
  it("matches whole words and phrases, ignoring case", () => {
    expect(forbiddenWordsIn("Cheapest prices in town", ["cheap"])).toEqual([]);
    expect(forbiddenWordsIn("Not cheap, just fair.", ["cheap"])).toEqual(["cheap"]);
    expect(forbiddenWordsIn("A limited time offer!", ["limited time"])).toEqual(["limited time"]);
    expect(forbiddenWordsIn("Price (guaranteed)", ["guaranteed"])).toEqual(["guaranteed"]);
    expect(forbiddenWordsIn("सबसे सस्ता", ["सस्ता"])).toEqual(["सस्ता"]);
  });
});

describeDb("a client's brand kit", () => {
  let editor: Actor;
  let viewer: Actor;
  let userId = "";
  let clientA = "";
  let clientB = "";
  let projectA = "";

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = user.id;
    editor = staff(user.id, EDITOR);
    viewer = staff(user.id, ["social.view"]);

    const [a, b] = await Promise.all([
      db.client.create({ data: { name: `${SUFFIX} A`, slug: `${SUFFIX}-a` }, select: { id: true } }),
      db.client.create({ data: { name: `${SUFFIX} B`, slug: `${SUFFIX}-b` }, select: { id: true } }),
    ]);
    clientA = a.id;
    clientB = b.id;
    const project = await db.project.create({
      data: { code: `B-${SUFFIX}`.slice(0, 20), name: "Retainer", clientId: clientA, managerId: user.id, startsAt: new Date(), status: "ACTIVE" },
      select: { id: true },
    });
    projectA = project.id;
  });

  afterEach(async () => {
    await db.socialPost.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentPillar.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialBrandProfile.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialStrategy.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
  });

  afterAll(async () => {
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  // -------------------------------------------------------------------------
  // Brand profile
  // -------------------------------------------------------------------------

  it("saves a brand profile, and audits the change", async () => {
    await saveBrandProfile(editor, clientA, brandProfileSchema.parse({ tone: "Warm and plain", hashtags: ["#northwind"] }));
    await saveBrandProfile(editor, clientA, brandProfileSchema.parse({ tone: "Warmer", hashtags: ["northwind"] }));

    const kit = await getBrandKit(editor, clientA);
    expect(kit.profile).toMatchObject({ tone: "Warmer", hashtags: ["northwind"] });
    const audits = await db.auditLog.count({ where: { entityType: "SocialBrandProfile", entityId: clientA } });
    expect(audits).toBe(2);
  });

  it("needs social.edit to change the kit, and a portal user cannot change it at all", async () => {
    await expect(saveBrandProfile(viewer, clientA, brandProfileSchema.parse({ tone: "x" }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createPillar(viewer, clientA, { name: "Offers", description: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveBrandProfile(portalUser(userId, clientB), clientA, brandProfileSchema.parse({ tone: "x" }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never shows one client's kit to another client's portal user", async () => {
    await saveBrandProfile(editor, clientA, brandProfileSchema.parse({ tone: "Secret tone" }));
    await expect(getBrandKit(portalUser(userId, clientB), clientA)).rejects.toBeInstanceOf(ForbiddenError);
    // Asking for "their own" returns their own — empty — not client A's.
    const own = await getBrandKit(portalUser(userId, clientB), null as unknown as string);
    expect(own.profile).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Pillars
  // -------------------------------------------------------------------------

  it("refuses two pillars with the same name for one client, in any case", async () => {
    await createPillar(editor, clientA, { name: "Customer stories", description: null });
    await expect(createPillar(editor, clientA, { name: "customer STORIES", description: null })).rejects.toBeInstanceOf(ConflictError);
    // Another client may use the same name.
    await expect(createPillar(editor, clientB, { name: "Customer stories", description: null })).resolves.toBeDefined();
  });

  it("orders pillars and moves them one step at a time", async () => {
    const a = await createPillar(editor, clientA, { name: "Education", description: null });
    const b = await createPillar(editor, clientA, { name: "Culture", description: null });
    const c = await createPillar(editor, clientA, { name: "Offers", description: null });
    expect((await activePillars(editor, clientA)).map((p) => p.id)).toEqual([a.id, b.id, c.id]);

    await movePillar(editor, c.id, "up");
    expect((await activePillars(editor, clientA)).map((p) => p.id)).toEqual([a.id, c.id, b.id]);
    // At the top already: nothing moves.
    await movePillar(editor, a.id, "up");
    expect((await activePillars(editor, clientA)).map((p) => p.id)).toEqual([a.id, c.id, b.id]);
  });

  it("archives a pillar: no longer offered, still on the ideas that had it", async () => {
    const pillar = await createPillar(editor, clientA, { name: "Festivals", description: null });
    const item = await createSocialContent(editor, {
      clientId: clientA, projectId: projectA, title: "Diwali post", brief: null, campaignId: null, pillarId: pillar.id, ownerId: null, scheduledFor: null,
    });

    await setPillarArchived(editor, pillar.id, true);
    expect((await activePillars(editor, clientA)).map((p) => p.id)).not.toContain(pillar.id);
    // The idea keeps it, and re-saving the same pillar is allowed.
    await expect(setContentPillar(editor, item.id, pillar.id)).resolves.toBeDefined();
    // But a new idea cannot be filed under an archived pillar.
    await expect(
      createSocialContent(editor, {
        clientId: clientA, projectId: projectA, title: "Holi post", brief: null, campaignId: null, pillarId: pillar.id, ownerId: null, scheduledFor: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("never files one client's idea under another client's pillar", async () => {
    const foreign = await createPillar(editor, clientB, { name: "B's pillar", description: null });
    await expect(
      createSocialContent(editor, {
        clientId: clientA, projectId: projectA, title: "Sneaky", brief: null, campaignId: null, pillarId: foreign.id, ownerId: null, scheduledFor: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const item = await createSocialContent(editor, {
      clientId: clientA, projectId: projectA, title: "Honest", brief: null, campaignId: null, pillarId: null, ownerId: null, scheduledFor: null,
    });
    await expect(setContentPillar(editor, item.id, foreign.id)).rejects.toBeInstanceOf(ValidationError);
    // And another client's pillar cannot be edited through this client.
    await expect(updatePillar(portalUser(userId, clientA), foreign.id, { name: "Renamed", description: null })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("filters the content list and the calendar by pillar", async () => {
    const education = await createPillar(editor, clientA, { name: "Education", description: null });
    const offers = await createPillar(editor, clientA, { name: "Offers", description: null });
    const when = new Date(Date.UTC(2026, 9, 5, 14, 0));
    const [edu, off] = await Promise.all([
      createSocialContent(editor, { clientId: clientA, projectId: projectA, title: "How it works", brief: null, campaignId: null, pillarId: education.id, ownerId: null, scheduledFor: when }),
      createSocialContent(editor, { clientId: clientA, projectId: projectA, title: "Festive offer", brief: null, campaignId: null, pillarId: offers.id, ownerId: null, scheduledFor: when }),
    ]);
    for (const itemId of [edu.id, off.id]) {
      await db.socialPost.create({
        data: { contentItemId: itemId, clientId: clientA, provider: "INSTAGRAM", type: "SINGLE_IMAGE", caption: "x", scheduledFor: when },
      });
    }

    const listed = await listContentItems(editor, { clientId: clientA, pillarId: education.id });
    expect(listed.map((i) => i.id)).toEqual([edu.id]);
    expect(listed[0]!.pillar?.name).toBe("Education");

    const { cards } = await calendarPosts(editor, {
      clientId: clientA,
      from: new Date(Date.UTC(2026, 9, 1)),
      to: new Date(Date.UTC(2026, 10, 1)),
      pillarId: offers.id,
    });
    expect(cards).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Strategy
  // -------------------------------------------------------------------------

  it("stores targets as agreed, and reads a damaged row as empty rather than crashing", async () => {
    await saveStrategy(
      editor,
      clientA,
      strategySchema.parse({
        objectives: "Be the furniture brand Mumbai trusts.",
        platforms: ["INSTAGRAM", "LINKEDIN"],
        postingFrequency: { INSTAGRAM: 4, LINKEDIN: 2 },
        kpiTargets: [{ metric: "reach", target: 50000, period: "MONTH" }],
      }),
    );
    const kit = await getBrandKit(editor, clientA);
    expect(kit.strategy).toMatchObject({
      platforms: ["INSTAGRAM", "LINKEDIN"],
      postingFrequency: { INSTAGRAM: 4, LINKEDIN: 2 },
      kpiTargets: [{ metric: "reach", target: 50000, period: "MONTH" }],
    });
    // Nothing on the record claims a target was met.
    expect(JSON.stringify(kit.strategy)).not.toMatch(/achiev|progress|met\b/i);

    await db.socialStrategy.update({
      where: { clientId: clientA },
      data: { postingFrequency: "nonsense", kpiTargets: [{ metric: "made-up", target: "lots" }] },
    });
    const damaged = await getBrandKit(editor, clientA);
    expect(damaged.strategy).toMatchObject({ postingFrequency: {}, kpiTargets: [] });
  });

  it("counts this week's real posts against the plan — nothing else", async () => {
    await saveStrategy(
      editor,
      clientA,
      strategySchema.parse({ platforms: ["INSTAGRAM"], postingFrequency: { INSTAGRAM: 3 } }),
    );
    const now = new Date(Date.UTC(2026, 9, 7, 6, 0)); // Wednesday
    const item = await createSocialContent(editor, {
      clientId: clientA, projectId: projectA, title: "Week", brief: null, campaignId: null, pillarId: null, ownerId: null, scheduledFor: null,
    });
    const at = (day: number) => new Date(Date.UTC(2026, 9, day, 8, 0));
    await db.socialPost.createMany({
      data: [
        { contentItemId: item.id, clientId: clientA, provider: "INSTAGRAM", type: "SINGLE_IMAGE", status: "PUBLISHED", scheduledFor: at(5), publishedAt: at(5) },
        { contentItemId: item.id, clientId: clientA, provider: "INSTAGRAM", type: "SINGLE_IMAGE", status: "SCHEDULED", scheduledFor: at(9) },
        // Not counted: a draft, and a post in another week.
        { contentItemId: item.id, clientId: clientA, provider: "INSTAGRAM", type: "SINGLE_IMAGE", status: "DRAFT", scheduledFor: at(8) },
        { contentItemId: item.id, clientId: clientA, provider: "INSTAGRAM", type: "SINGLE_IMAGE", status: "SCHEDULED", scheduledFor: at(14) },
      ],
    });

    const week = await postingThisWeek(editor, clientA, now);
    expect(week?.rows).toEqual([{ provider: "INSTAGRAM", planned: 3, scheduled: 1, published: 1 }]);
  });

  it("has nothing to compare when no frequency is planned", async () => {
    expect(await postingThisWeek(editor, clientA)).toBeNull();
  });
});

describeDb("AI drafting reads the brand kit", () => {
  let double: AnthropicDouble;
  let writer: Actor;
  let clientId = "";
  let itemId = "";

  beforeAll(async () => {
    double = await startAnthropicDouble();
    process.env["AI_PROVIDER"] = "anthropic";
    process.env["AI_API_KEY"] = "test-key";
    process.env["AI_BASE_URL"] = double.url;
    resetEnvCache();

    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    writer = staff(user.id, EDITOR);
    await db.rateLimitWindow.deleteMany({ where: { key: `ai:draftSocialPost:${user.id}` } });

    const client = await db.client.create({ data: { name: `${SUFFIX} AI Client`, slug: `${SUFFIX}-ai` }, select: { id: true } });
    clientId = client.id;
    const project = await db.project.create({
      data: { code: `BA-${SUFFIX}`.slice(0, 20), name: "Retainer", clientId, managerId: user.id, startsAt: new Date(), status: "ACTIVE" },
      select: { id: true },
    });
    const pillar = await createPillar(writer, clientId, { name: "Customer stories", description: "Real homes, real owners." });
    await saveBrandProfile(
      writer,
      clientId,
      brandProfileSchema.parse({
        brandName: "Northwind",
        tone: "Warm, plain-spoken",
        preferredLanguage: "Hinglish",
        hashtags: ["northwind"],
        forbiddenWords: ["cheap", "limited time"],
      }),
    );
    const item = await createSocialContent(writer, {
      clientId, projectId: project.id, title: "A family's new living room", brief: "Story of the Mehta family's makeover.", campaignId: null, pillarId: pillar.id, ownerId: null, scheduledFor: null,
    });
    itemId = item.id;
  });

  afterAll(async () => {
    await db.contentCalendarItem.deleteMany({ where: { clientId } });
    await db.contentPillar.deleteMany({ where: { clientId } });
    await db.socialBrandProfile.deleteMany({ where: { clientId } });
    await db.project.deleteMany({ where: { clientId } });
    await db.client.deleteMany({ where: { id: clientId } });
    await double.close();
    delete process.env["AI_BASE_URL"];
    resetEnvCache();
  });

  it("gives the model the brand's voice, language, pillar and forbidden words", async () => {
    double.reply({ caption: "The Mehtas' living room, redone.", headline: null, hashtags: ["homes"] });
    const draft = await draftSocialPost(writer, { contentItemId: itemId, provider: "INSTAGRAM", type: "SINGLE_IMAGE", instruction: null });

    const sent = JSON.stringify(double.requests.at(-1));
    expect(sent).toContain("Northwind");
    expect(sent).toContain("Warm, plain-spoken");
    expect(sent).toContain("Hinglish");
    expect(sent).toContain("Customer stories");
    expect(sent).toContain("Never use these words or phrases: cheap, limited time");
    // The brand's own hashtag is added where the model left it out.
    expect(draft.data.hashtags).toEqual(["homes", "northwind"]);
    expect(draft.data.forbiddenUsed).toEqual([]);
  });

  it("flags a draft that used a forbidden word anyway, rather than trusting the model", async () => {
    double.reply({ caption: "Not cheap — just built to last. Limited time only.", headline: null, hashtags: [] });
    const draft = await draftSocialPost(writer, { contentItemId: itemId, provider: "INSTAGRAM", type: "SINGLE_IMAGE", instruction: null });
    expect(draft.data.forbiddenUsed.sort()).toEqual(["cheap", "limited time"]);
    // Flagged, not rewritten: the operator decides.
    expect(draft.data.caption).toContain("cheap");
  });

  it("does not add brand hashtags where the platform has none", async () => {
    double.reply({ caption: "Open late this week.", headline: null, hashtags: [] });
    const draft = await draftSocialPost(writer, { contentItemId: itemId, provider: "GOOGLE_BUSINESS_PROFILE", type: "GBP_POST", instruction: null });
    expect(draft.data.hashtags).toEqual([]);
  });
});
