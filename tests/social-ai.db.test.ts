import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { draftSocialPost } from "@/lib/services/ai.service";
import { SYSTEM_PROMPTS } from "@/lib/ai/prompts";
import { resetEnvCache } from "@/lib/config/env";
import { startAnthropicDouble, type AnthropicDouble } from "./support/anthropic-double";
import type { Actor } from "@/lib/actor/types";

/**
 * Drafting captions.
 *
 * What matters is not that the model writes something — it is that the draft
 * stays a draft, is bounded by the platform it is for, and cannot put a number
 * in front of a client that nobody gave it.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `sai9-${Date.now()}`;

function actorWith(userId: string, permissions: string[]): Actor {
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

describe("the social drafting prompt", () => {
  it("forbids inventing figures before it mentions anything about tone", () => {
    const prompt = SYSTEM_PROMPTS.draftSocialPost;
    expect(prompt).toContain("Never invent a fact");
    expect(prompt).toMatch(/your caption does not contain a number/i);
    // The ordering is deliberate: the rule that gets an agency in trouble
    // comes first, so a model truncating its context keeps it.
    expect(prompt.indexOf("Never invent a fact")).toBeLessThan(prompt.indexOf("voice"));
  });

  it("forbids invented offers and guarantees, not just numbers", () => {
    expect(SYSTEM_PROMPTS.draftSocialPost).toMatch(/offer, a discount, a deadline or a guarantee/);
  });
});

describeDb("drafting a social caption", () => {
  let double: AnthropicDouble;
  let writer: Actor;
  let outsider: Actor;
  let clientA = "";
  let projectA = "";
  let itemId = "";
  let emptyItemId = "";
  let userId = "";

  beforeAll(async () => {
    double = await startAnthropicDouble();
    process.env["AI_PROVIDER"] = "anthropic";
    process.env["AI_API_KEY"] = "test-key";
    process.env["AI_BASE_URL"] = double.url;
    resetEnvCache();

    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = staff.id;
    writer = actorWith(staff.id, ["ai.use", "social.edit", "social.view"]);
    outsider = actorWith(staff.id, ["social.edit", "social.view"]);

    await db.rateLimitWindow.deleteMany({
      where: { key: `ai:draftSocialPost:${staff.id}` },
    });

    const client = await db.client.create({
      data: { name: `${SUFFIX} Northwind`, slug: `${SUFFIX}-a`, industry: "Home furniture" },
      select: { id: true },
    });
    clientA = client.id;

    const project = await db.project.create({
      data: {
        code: `${SUFFIX}-A`.slice(0, 20),
        name: "A retainer",
        clientId: clientA,
        managerId: staff.id,
        startsAt: new Date(),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    projectA = project.id;

    const item = await db.contentCalendarItem.create({
      data: {
        clientId: clientA,
        projectId: projectA,
        title: "Festive living room refresh",
        brief: "Three-room styling reel for the festive push. No discounts this year.",
        channel: "INSTAGRAM",
        stage: "DRAFT",
      },
      select: { id: true },
    });
    itemId = item.id;

    const empty = await db.contentCalendarItem.create({
      data: {
        clientId: clientA,
        projectId: projectA,
        title: "  ",
        channel: "INSTAGRAM",
        stage: "IDEA",
      },
      select: { id: true },
    });
    emptyItemId = empty.id;
  });

  afterAll(async () => {
    await db.contentCalendarItem.deleteMany({ where: { clientId: clientA } });
    await db.project.deleteMany({ where: { clientId: clientA } });
    await db.client.deleteMany({ where: { id: clientA } });
    await double.close();
    delete process.env["AI_BASE_URL"];
    resetEnvCache();
  });

  it("returns a labelled draft, never a saved post", async () => {
    double.reply({ caption: "Three rooms, one afternoon.", headline: null, hashtags: ["festive"] });

    const draft = await draftSocialPost(writer, {
      contentItemId: itemId,
      provider: "INSTAGRAM",
      type: "REEL",
      instruction: null,
    });

    expect(draft.generated).toBe(true);
    expect(draft.task).toBe("draftSocialPost");
    expect(draft.data.caption).toBe("Three rooms, one afternoon.");
    // Nothing was written. The editor puts it in the form; a person saves it.
    expect(await db.socialPost.count({ where: { contentItemId: itemId } })).toBe(0);
  });

  it("tells the model the platform's real character limit", async () => {
    double.reply({ caption: "Short.", headline: null, hashtags: [] });
    await draftSocialPost(writer, {
      contentItemId: itemId,
      provider: "X",
      type: "TEXT",
      instruction: null,
    });

    const sent = JSON.stringify(double.requests.at(-1));
    expect(sent).toContain("280");
  });

  it("truncates a caption the platform would refuse", async () => {
    double.reply({ caption: "x".repeat(900), headline: null, hashtags: [] });

    const draft = await draftSocialPost(writer, {
      contentItemId: itemId,
      provider: "X",
      type: "TEXT",
      instruction: null,
    });

    // Over the limit is unusable; keeping it would push the failure to 7:30pm.
    expect(draft.data.caption).toHaveLength(280);
  });

  it("drops hashtags on a platform that has none", async () => {
    double.reply({ caption: "A post.", headline: null, hashtags: ["one", "two"] });

    const draft = await draftSocialPost(writer, {
      contentItemId: itemId,
      provider: "GOOGLE_BUSINESS_PROFILE",
      type: "GBP_POST",
      instruction: null,
    });

    expect(draft.data.hashtags).toEqual([]);
  });

  it("drops a headline on a platform that has none", async () => {
    double.reply({ caption: "A post.", headline: "A headline", hashtags: [] });

    const draft = await draftSocialPost(writer, {
      contentItemId: itemId,
      provider: "INSTAGRAM",
      type: "REEL",
      instruction: null,
    });

    expect(draft.data.headline).toBeNull();
  });

  it("normalises hashtags the same way the editor does", async () => {
    double.reply({
      caption: "A post.",
      headline: null,
      hashtags: ["#Festive", " homestyling ", "not a tag", ""],
    });

    const draft = await draftSocialPost(writer, {
      contentItemId: itemId,
      provider: "INSTAGRAM",
      type: "REEL",
      instruction: null,
    });

    // A hash-prefixed tag and a typed one must not become two different tags.
    expect(draft.data.hashtags).toEqual(["Festive", "homestyling"]);
  });

  it("refuses to draft from an idea with nothing in it", async () => {
    double.reply({ caption: "Invented.", headline: null, hashtags: [] });

    await expect(
      draftSocialPost(writer, {
        contentItemId: emptyItemId,
        provider: "INSTAGRAM",
        type: "REEL",
        instruction: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("gives the model the brief rather than letting it guess", async () => {
    double.reply({ caption: "A post.", headline: null, hashtags: [] });
    await draftSocialPost(writer, {
      contentItemId: itemId,
      provider: "LINKEDIN",
      type: "TEXT",
      instruction: "keep it warm",
    });

    const sent = JSON.stringify(double.requests.at(-1));
    expect(sent).toContain("No discounts this year");
    expect(sent).toContain("keep it warm");
    expect(sent).toContain("Home furniture");
  });

  it("refuses an actor without ai.use", async () => {
    await expect(
      draftSocialPost(outsider, {
        contentItemId: itemId,
        provider: "INSTAGRAM",
        type: "REEL",
        instruction: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a portal user drafting for another client", async () => {
    const other = await db.client.create({
      data: { name: `${SUFFIX} Other`, slug: `${SUFFIX}-b` },
      select: { id: true },
    });
    const portal: Actor = {
      ...actorWith(userId, ["ai.use", "social.edit", "social.view"]),
      type: "CLIENT",
      roleName: "CLIENT_USER",
      clientId: other.id,
    };

    await expect(
      draftSocialPost(portal, {
        contentItemId: itemId,
        provider: "INSTAGRAM",
        type: "REEL",
        instruction: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    await db.client.delete({ where: { id: other.id } });
  });

  it("audits the call against the idea it drafted for", async () => {
    double.reply({ caption: "Audited.", headline: null, hashtags: [] });
    await draftSocialPost(writer, {
      contentItemId: itemId,
      provider: "INSTAGRAM",
      type: "REEL",
      instruction: null,
    });

    const entry = await db.auditLog.findFirst({
      where: { entityType: "AIDraft", entityId: `draftSocialPost:${itemId}` },
      orderBy: { createdAt: "desc" },
      select: { after: true },
    });
    expect(entry).not.toBeNull();
    // The token spend is on the record, so a bill can be explained.
    expect(entry!.after).toMatchObject({ task: "draftSocialPost" });
  });
});
