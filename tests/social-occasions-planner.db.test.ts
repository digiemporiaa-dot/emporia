import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  addOccasionDate,
  clientOccasions,
  createOccasion,
  listLibrary,
  occasionsBetween,
  occurrences,
  setClientOccasion,
  setOccasionArchived,
  updateOccasion,
} from "@/lib/services/social-occasion.service";
import { planContentMonth } from "@/lib/services/ai.service";
import { createPlannedContent, type PlannedItemInput } from "@/lib/services/social-planner.service";
import { createPillar } from "@/lib/services/social-brand.service";
import { requestSocialApproval } from "@/lib/services/social-approval.service";
import { occasionSchema } from "@/lib/validation/social-occasion";
import { pillarSchema } from "@/lib/validation/social-brand";
import { resetEnvCache } from "@/lib/config/env";
import { startAnthropicDouble, type AnthropicDouble } from "./support/anthropic-double";
import type { Actor } from "@/lib/actor/types";

/**
 * The occasion library and the month planner.
 *
 * Pinned: occasions reach a client only by choice — a library one it opted in
 * to, or its own — and never another client's. Moving festivals carry only
 * the dates a person entered; nothing is computed. The planner's counts are
 * arithmetic, whatever the model returns, and anything it invents (a date
 * outside the month, a format the platform lacks, a pillar or occasion that
 * was not offered, an occasion on the wrong day) is dropped. What the planner
 * creates is draft ideas with empty, AI-marked versions that cannot go to the
 * client until someone writes them.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const SUFFIX = `occ-${Date.now()}`;

function staff(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Planner",
    email: "planner@emporia.test",
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const EDITOR = ["ai.use", "social.view", "social.create", "social.edit", "social.approve"];
const occasion = (input: Record<string, unknown>) => occasionSchema.parse({ category: "FESTIVAL", ...input });

describe("occurrences", () => {
  it("repeats a fixed day every year in range", () => {
    expect(occurrences({ fixedMonth: 1, fixedDay: 26, dates: [] }, "2026-01-01", "2027-12-31")).toEqual(["2026-01-26", "2027-01-26"]);
  });

  it("skips 29 February in a year that has none", () => {
    expect(occurrences({ fixedMonth: 2, fixedDay: 29, dates: [] }, "2026-01-01", "2028-12-31")).toEqual(["2028-02-29"]);
  });

  it("uses only the entered dates for a moving occasion", () => {
    const dates = [{ id: "a", date: new Date("2026-11-08T00:00:00Z") }, { id: "b", date: new Date("2027-10-29T00:00:00Z") }];
    expect(occurrences({ fixedMonth: null, fixedDay: null, dates }, "2026-11-01", "2026-11-30")).toEqual(["2026-11-08"]);
    expect(occurrences({ fixedMonth: null, fixedDay: null, dates: [] }, "2026-01-01", "2026-12-31")).toEqual([]);
  });
});

describe("occasionSchema", () => {
  it("wants both month and day, or neither", () => {
    expect(occasionSchema.safeParse({ name: "Half", category: "BRAND", fixedMonth: 3, fixedDay: null }).success).toBe(false);
  });

  it("refuses a day the month does not have, but allows 29 February", () => {
    expect(occasionSchema.safeParse({ name: "Bad", category: "BRAND", fixedMonth: 4, fixedDay: 31 }).success).toBe(false);
    expect(occasionSchema.safeParse({ name: "Leap", category: "BRAND", fixedMonth: 2, fixedDay: 29 }).success).toBe(true);
  });
});

describeDb("occasion library and month planner", () => {
  let double: AnthropicDouble;
  let editor: Actor;
  let manager: Actor;
  let userId = "";
  let clientA = "";
  let clientB = "";
  let projectA = "";
  let projectB = "";
  let republic = "";
  let diwali = "";
  let unchosen = "";
  let ownA = "";
  let ownB = "";
  let pillarId = "";

  beforeAll(async () => {
    double = await startAnthropicDouble();
    process.env["AI_PROVIDER"] = "anthropic";
    process.env["AI_API_KEY"] = "test-key";
    process.env["AI_BASE_URL"] = double.url;
    resetEnvCache();

    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = user.id;
    editor = staff(user.id, EDITOR);
    manager = staff(user.id, [...EDITOR, "social.occasions.manage"]);
    await db.rateLimitWindow.deleteMany({ where: { key: { startsWith: "ai:" }, AND: { key: { contains: user.id } } } });

    const [a, b] = await Promise.all([
      db.client.create({ data: { name: `${SUFFIX} Northwind`, slug: `${SUFFIX}-a`, industry: "Sweets" }, select: { id: true } }),
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

    republic = (await createOccasion(manager, null, occasion({ name: `${SUFFIX} Republic`, category: "NATIONAL_DAY", fixedMonth: 1, fixedDay: 26 }))).id;
    diwali = (await createOccasion(manager, null, occasion({ name: `${SUFFIX} Diwali` }))).id;
    unchosen = (await createOccasion(manager, null, occasion({ name: `${SUFFIX} Unchosen`, fixedMonth: 11, fixedDay: 3 }))).id;
    await addOccasionDate(manager, diwali, "2026-11-08");
    ownA = (await createOccasion(editor, clientA, occasion({ name: "Store anniversary", category: "BRAND", fixedMonth: 11, fixedDay: 20 }))).id;
    ownB = (await createOccasion(editor, clientB, occasion({ name: "Store anniversary", category: "BRAND", fixedMonth: 11, fixedDay: 12 }))).id;
    await setClientOccasion(editor, clientA, diwali, true);
    await setClientOccasion(editor, clientA, republic, true);

    pillarId = (await createPillar(editor, clientA, pillarSchema.parse({ name: "Behind the counter" }))).id;
  });

  afterEach(async () => {
    await db.approval.deleteMany({ where: { contentItem: { clientId: { in: [clientA, clientB] } } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
  });

  afterAll(async () => {
    await db.contentOccasion.deleteMany({ where: { OR: [{ name: { startsWith: SUFFIX } }, { clientId: { in: [clientA, clientB] } }] } });
    await db.contentPillar.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
    await double.close();
    delete process.env["AI_BASE_URL"];
    resetEnvCache();
  });

  // -------------------------------------------------------------------------
  // The library
  // -------------------------------------------------------------------------

  it("lets only occasion managers change the library", async () => {
    await expect(createOccasion(editor, null, occasion({ name: `${SUFFIX} Nope` }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addOccasionDate(editor, diwali, "2027-10-29")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setOccasionArchived(editor, republic, true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a second name clash, on create and on rename", async () => {
    await expect(createOccasion(manager, null, occasion({ name: `${SUFFIX} diwali` }))).rejects.toBeInstanceOf(ConflictError);
    await expect(
      updateOccasion(manager, unchosen, occasion({ name: `${SUFFIX} Diwali`, fixedMonth: 11, fixedDay: 3 })),
    ).rejects.toBeInstanceOf(ConflictError);
    // The same name in two different clients is two different occasions.
    expect(ownA).not.toBe(ownB);
  });

  it("keeps one date per year for a moving occasion, and none for a fixed one", async () => {
    await expect(addOccasionDate(manager, diwali, "2026-11-09")).rejects.toBeInstanceOf(ConflictError);
    await expect(addOccasionDate(manager, republic, "2026-01-27")).rejects.toBeInstanceOf(ValidationError);
    // The same date again is harmless.
    await addOccasionDate(manager, diwali, "2026-11-08");
    expect(await db.contentOccasionDate.count({ where: { occasionId: diwali } })).toBe(1);
  });

  it("drops entered dates when an occasion becomes fixed", async () => {
    const moving = await createOccasion(manager, null, occasion({ name: `${SUFFIX} Mover` }));
    await addOccasionDate(manager, moving.id, "2026-03-04");
    await updateOccasion(manager, moving.id, occasion({ name: `${SUFFIX} Mover`, fixedMonth: 3, fixedDay: 10 }));
    expect(await db.contentOccasionDate.count({ where: { occasionId: moving.id } })).toBe(0);
  });

  it("shows the library to staff only", async () => {
    const portal: Actor = { ...editor, type: "CLIENT", clientId: clientA, roleName: "CLIENT_USER" };
    expect(await listLibrary(portal)).toEqual([]);
    expect((await listLibrary(editor)).some((o) => o.id === diwali)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // What a client sees
  // -------------------------------------------------------------------------

  it("gives a client its chosen library occasions and its own — nothing else", async () => {
    const days = await occasionsBetween(editor, clientA, "2026-11-01", "2026-11-30");
    expect(days.map((d) => [d.name, d.day])).toEqual([
      [`${SUFFIX} Diwali`, "2026-11-08"],
      ["Store anniversary", "2026-11-20"],
    ]);
    // Not opted in, and client B's anniversary on the 12th, are both absent.
    expect(days.some((d) => d.occasionId === unchosen || d.occasionId === ownB)).toBe(false);

    const panel = await clientOccasions(editor, clientA);
    expect(panel.library.find((o) => o.id === diwali)?.optedIn).toBe(true);
    expect(panel.library.find((o) => o.id === unchosen)?.optedIn).toBe(false);
    expect(panel.own.map((o) => o.id)).toEqual([ownA]);
  });

  it("will not opt a client in to another client's own occasion", async () => {
    await expect(setClientOccasion(editor, clientA, ownB, true)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("will not let one client's editor change another client's occasion through a portal", async () => {
    const portal: Actor = { ...editor, type: "CLIENT", clientId: clientA, roleName: "CLIENT_USER" };
    // A portal actor is pinned to its own client: B's occasion is out of reach.
    await expect(updateOccasion(portal, ownB, occasion({ name: "Mine now", fixedMonth: 1, fixedDay: 1 }))).rejects.toThrow();
    expect((await db.contentOccasion.findUniqueOrThrow({ where: { id: ownB } })).name).toBe("Store anniversary");
  });

  it("hides an archived occasion from the calendar", async () => {
    await setOccasionArchived(manager, republic, true);
    try {
      expect(await occasionsBetween(editor, clientA, "2027-01-01", "2027-01-31")).toEqual([]);
    } finally {
      await setOccasionArchived(manager, republic, false);
    }
    expect((await occasionsBetween(editor, clientA, "2027-01-01", "2027-01-31")).map((d) => d.day)).toEqual(["2027-01-26"]);
  });

  // -------------------------------------------------------------------------
  // Planning
  // -------------------------------------------------------------------------

  it("asks for counts it worked out itself, and keeps only what fits", async () => {
    double.reply({
      items: [
        { date: "2026-11-08", title: "Diwali hampers", brief: "Our boxes.", pillar: "behind the counter", campaign: null, occasion: `${SUFFIX} Diwali`, versions: [{ provider: "INSTAGRAM", type: "REEL" }] },
        // Outside the month.
        { date: "2026-12-01", title: "December", brief: "x", pillar: null, campaign: null, occasion: null, versions: [{ provider: "INSTAGRAM", type: "REEL" }] },
        // A format Instagram does not have.
        { date: "2026-11-10", title: "Wrong format", brief: "x", pillar: null, campaign: null, occasion: null, versions: [{ provider: "INSTAGRAM", type: "TEXT" }] },
        // An occasion on the wrong day, and a pillar that does not exist: both dropped, the idea kept.
        { date: "2026-11-02", title: "Early lights", brief: "Prep.", pillar: "Invented", campaign: null, occasion: `${SUFFIX} Diwali`, versions: [{ provider: "INSTAGRAM", type: "SINGLE_IMAGE" }] },
        // An occasion that was not offered.
        { date: "2026-11-03", title: "Unchosen day", brief: "x", pillar: null, campaign: null, occasion: `${SUFFIX} Unchosen`, versions: [{ provider: "INSTAGRAM", type: "CAROUSEL" }] },
        // A repeated title.
        { date: "2026-11-04", title: "diwali hampers", brief: "again", pillar: null, campaign: null, occasion: null, versions: [{ provider: "INSTAGRAM", type: "REEL" }] },
        // Over the Instagram target (2 per week × 30 / 7 = 9): the tenth and later are dropped.
        ...Array.from({ length: 12 }, (_, i) => ({
          date: `2026-11-${String(11 + i).padStart(2, "0")}`,
          title: `Filler ${i}`,
          brief: "x",
          pillar: null,
          campaign: null,
          occasion: null,
          versions: [{ provider: "INSTAGRAM", type: "SINGLE_IMAGE" }],
        })),
      ],
    });

    const draft = await planContentMonth(editor, {
      clientId: clientA,
      month: "2026-11",
      frequency: { INSTAGRAM: 2 },
      pillarIds: [],
      campaignIds: [],
      occasionIds: [diwali],
      instruction: null,
    });

    const sent = JSON.stringify(double.requests.at(-1));
    expect(sent).toContain("INSTAGRAM (Instagram): 9 posts");
    expect(sent).toContain(`${SUFFIX} Diwali: 2026-11-08`);
    // Chosen occasions only: the client's anniversary was not ticked.
    expect(sent).not.toContain("Store anniversary");

    expect(draft.data.targets).toEqual({ INSTAGRAM: 9 });
    expect(draft.data.planned).toEqual({ INSTAGRAM: 9 });
    const byTitle = new Map(draft.data.items.map((item) => [item.title, item]));
    expect(byTitle.get("Diwali hampers")).toMatchObject({ occasionId: diwali, pillarId, day: "2026-11-08" });
    expect(byTitle.get("Early lights")).toMatchObject({ occasionId: null, pillarId: null });
    expect(byTitle.get("Unchosen day")?.occasionId).toBeNull();
    for (const gone of ["December", "Wrong format", "diwali hampers"]) expect(byTitle.has(gone)).toBe(false);
    expect(draft.data.items.reduce((sum, item) => sum + item.versions.length, 0)).toBe(9);
    // Nothing written by drafting.
    expect(await db.contentCalendarItem.count({ where: { clientId: clientA } })).toBe(0);
  });

  it("refuses a plan too big, or with nothing to post, before asking the model", async () => {
    const before = double.requests.length;
    const base = { clientId: clientA, month: "2026-11", pillarIds: [], campaignIds: [], occasionIds: [], instruction: null };
    await expect(planContentMonth(editor, { ...base, frequency: { INSTAGRAM: 21, FACEBOOK: 21 } })).rejects.toBeInstanceOf(ValidationError);
    await expect(planContentMonth(editor, { ...base, frequency: { INSTAGRAM: 0 } })).rejects.toBeInstanceOf(ValidationError);
    await expect(planContentMonth(editor, { ...base, month: "2026-13", frequency: { INSTAGRAM: 1 } })).rejects.toBeInstanceOf(ValidationError);
    expect(double.requests.length).toBe(before);
  });

  it("refuses another client's campaign", async () => {
    const campaign = await db.campaign.create({
      data: { clientId: clientB, name: `${SUFFIX} B sale`, startsAt: new Date("2026-11-01"), status: "ACTIVE", platform: "META_ADS", ownerId: userId },
      select: { id: true },
    });
    try {
      await expect(
        planContentMonth(editor, {
          clientId: clientA,
          month: "2026-11",
          frequency: { INSTAGRAM: 1 },
          pillarIds: [],
          campaignIds: [campaign.id],
          occasionIds: [],
          instruction: null,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    } finally {
      await db.campaign.delete({ where: { id: campaign.id } });
    }
  });

  // -------------------------------------------------------------------------
  // Creating what was kept
  // -------------------------------------------------------------------------

  const item = (overrides: Partial<PlannedItemInput> = {}): PlannedItemInput => ({
    day: "2026-11-08",
    title: "Diwali hampers",
    brief: "Our boxes.",
    pillarId: null,
    campaignId: null,
    occasionId: null,
    versions: [
      { provider: "INSTAGRAM", type: "REEL" },
      { provider: "FACEBOOK", type: "SINGLE_IMAGE" },
    ],
    ...overrides,
  });

  it("creates draft ideas at 10:00 IST with empty versions marked as AI drafts", async () => {
    const result = await createPlannedContent(editor, {
      clientId: clientA,
      projectId: projectA,
      month: "2026-11",
      items: [item({ occasionId: diwali, pillarId }), item({ day: "2026-11-20", title: "Ten years", occasionId: ownA, versions: [{ provider: "LINKEDIN", type: "TEXT" }] })],
    });
    expect(result.created).toBe(2);

    const ideas = await db.contentCalendarItem.findMany({
      where: { clientId: clientA },
      orderBy: { scheduledFor: "asc" },
      select: { id: true, stage: true, scheduledFor: true, brief: true, pillarId: true, socialPosts: { select: { provider: true, caption: true, status: true, aiDraftedAt: true } } },
    });
    expect(ideas).toHaveLength(2);
    expect(ideas[0]!.stage).toBe("DRAFT");
    // 10:00 in Asia/Kolkata is 04:30 UTC.
    expect(ideas[0]!.scheduledFor?.toISOString()).toBe("2026-11-08T04:30:00.000Z");
    expect(ideas[0]!.brief).toMatch(new RegExp(`^Occasion: ${SUFFIX} Diwali\\.`));
    expect(ideas[0]!.pillarId).toBe(pillarId);
    expect(ideas[0]!.socialPosts).toHaveLength(2);
    for (const post of ideas.flatMap((i) => i.socialPosts)) {
      expect(post.caption ?? "").toBe("");
      expect(post.status).toBe("DRAFT");
      expect(post.aiDraftedAt).not.toBeNull();
    }

    // Not sendable to the client until someone writes and saves it.
    await expect(requestSocialApproval(editor, { contentItemId: ideas[0]!.id, note: null })).rejects.toThrow();
  });

  it("refuses an occasion the client does not have on that day, before writing anything", async () => {
    const base = { clientId: clientA, projectId: projectA, month: "2026-11" };
    await expect(createPlannedContent(editor, { ...base, items: [item({ occasionId: unchosen, day: "2026-11-03" })] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createPlannedContent(editor, { ...base, items: [item({ occasionId: ownB, day: "2026-11-12" })] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createPlannedContent(editor, { ...base, items: [item({ occasionId: diwali, day: "2026-11-09" })] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createPlannedContent(editor, { ...base, items: [item({ day: "2026-12-01" })] })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createPlannedContent(editor, { ...base, items: [item({ versions: [{ provider: "INSTAGRAM", type: "TEXT" }] })] }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await db.contentCalendarItem.count({ where: { clientId: clientA } })).toBe(0);
  });

  it("undoes the whole plan when one item fails part-way", async () => {
    // The second item's pillar is client B's: caught only when that item is created.
    const foreignPillar = await createPillar(editor, clientB, pillarSchema.parse({ name: `${SUFFIX} B pillar` }));
    await expect(
      createPlannedContent(editor, {
        clientId: clientA,
        projectId: projectA,
        month: "2026-11",
        items: [item(), item({ day: "2026-11-09", title: "Second", pillarId: foreignPillar.id })],
      }),
    ).rejects.toThrow();
    expect(await db.contentCalendarItem.count({ where: { clientId: clientA } })).toBe(0);
    expect(await db.socialPost.count({ where: { clientId: clientA } })).toBe(0);
  });

  it("refuses another client's project and a portal user", async () => {
    await expect(
      createPlannedContent(editor, { clientId: clientA, projectId: projectB, month: "2026-11", items: [item()] }),
    ).rejects.toThrow();
    const portal: Actor = { ...editor, type: "CLIENT", clientId: clientB, roleName: "CLIENT_USER", permissions: new Set(["social.view"]) };
    await expect(
      createPlannedContent(portal, { clientId: clientA, projectId: projectA, month: "2026-11", items: [item()] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.contentCalendarItem.count({ where: { clientId: { in: [clientA, clientB] } } })).toBe(0);
  });
});
