import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { calendarPosts, unscheduledPosts } from "@/lib/services/social-calendar.service";
import { buildGrid, CALENDAR_TIME_ZONE, parseAnchor } from "@/lib/social/calendar";
import type { Actor } from "@/lib/actor/types";

/**
 * The calendar's reads.
 *
 * Two things here are easy to get wrong and expensive to get wrong late: a
 * version that inherits its date from its idea must still appear in the month
 * that date falls in, and nothing belonging to another client may appear at
 * all. Both are pinned below against a real database.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `cal4-${Date.now()}`;
const IST = CALENDAR_TIME_ZONE;

function staffWith(userId: string, permissions: string[]): Actor {
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

/** October 2026, as the page builds it. */
function october() {
  return buildGrid("month", parseAnchor("2026-10", IST), IST, new Date("2026-10-08T06:00:00Z"));
}

describeDb("social calendar", () => {
  let staff: Actor;
  let portal: Actor;
  let clientA = "";
  let clientB = "";
  let projectA = "";
  let campaignA = "";
  let itemDated = "";
  let itemUndated = "";
  let userId = "";

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = user.id;
    staff = staffWith(user.id, ["social.view"]);

    const [a, b] = await Promise.all([
      db.client.create({ data: { name: `${SUFFIX} A`, slug: `${SUFFIX}-a` }, select: { id: true } }),
      db.client.create({ data: { name: `${SUFFIX} B`, slug: `${SUFFIX}-b` }, select: { id: true } }),
    ]);
    clientA = a.id;
    clientB = b.id;

    portal = {
      ...staffWith(user.id, ["social.view"]),
      type: "CLIENT",
      roleName: "CLIENT_USER",
      clientId: clientB,
    };

    const project = await db.project.create({
      data: {
        code: `${SUFFIX}-A`.slice(0, 20),
        name: "A retainer",
        clientId: clientA,
        managerId: user.id,
        startsAt: new Date(),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    projectA = project.id;

    const campaign = await db.campaign.create({
      data: {
        name: `${SUFFIX} Diwali`,
        clientId: clientA,
        platform: "SOCIAL_ORGANIC",
        ownerId: user.id,
        startsAt: new Date(),
      },
      select: { id: true },
    });
    campaignA = campaign.id;

    // An idea whose target date is 6 Oct 2026, 01:00 IST — which is 5 Oct in
    // UTC. Its versions are the interesting cases.
    const dated = await db.contentCalendarItem.create({
      data: {
        clientId: clientA,
        projectId: projectA,
        campaignId: campaignA,
        ownerId: user.id,
        title: `${SUFFIX} Diwali launch`,
        channel: "INSTAGRAM",
        stage: "CLIENT_REVIEW",
        scheduledFor: new Date("2026-10-05T19:30:00Z"),
      },
      select: { id: true },
    });
    itemDated = dated.id;

    const undated = await db.contentCalendarItem.create({
      data: {
        clientId: clientA,
        projectId: projectA,
        ownerId: user.id,
        title: `${SUFFIX} Someday`,
        channel: "INSTAGRAM",
        stage: "DRAFT",
      },
      select: { id: true },
    });
    itemUndated = undated.id;

    await db.socialPost.createMany({
      data: [
        // Its own time: 5 Oct, 7:30pm IST.
        {
          contentItemId: itemDated,
          clientId: clientA,
          provider: "INSTAGRAM",
          type: "REEL",
          status: "SCHEDULED",
          caption: "Festive reel",
          scheduledFor: new Date("2026-10-05T14:00:00Z"),
          order: 0,
        },
        // No time of its own — inherits the idea's 6 Oct 01:00 IST.
        {
          contentItemId: itemDated,
          clientId: clientA,
          provider: "LINKEDIN",
          type: "TEXT",
          status: "DRAFT",
          caption: "Festive note",
          order: 1,
        },
        // 3 Nov: outside October, but inside the six-row grid October draws,
        // which runs Mon 28 Sep to Sun 8 Nov.
        {
          contentItemId: itemDated,
          clientId: clientA,
          provider: "X",
          type: "TEXT",
          status: "DRAFT",
          scheduledFor: new Date("2026-11-03T06:00:00Z"),
          order: 2,
        },
        // 20 Nov: outside the grid entirely.
        {
          contentItemId: itemDated,
          clientId: clientA,
          provider: "FACEBOOK",
          type: "TEXT",
          status: "DRAFT",
          scheduledFor: new Date("2026-11-20T06:00:00Z"),
          order: 3,
        },
        // No date anywhere.
        {
          contentItemId: itemUndated,
          clientId: clientA,
          provider: "INSTAGRAM",
          type: "SINGLE_IMAGE",
          status: "DRAFT",
          caption: "Unscheduled idea",
          order: 0,
        },
      ],
    });
  });

  afterAll(async () => {
    await db.socialPost.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.campaign.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  // -------------------------------------------------------------------------
  // The inherited date
  // -------------------------------------------------------------------------

  it("includes a version that has no date of its own but whose idea does", async () => {
    const { cards } = await calendarPosts(staff, { clientId: clientA, ...october().range });
    const linkedin = cards.find((card) => card.provider === "LINKEDIN");

    expect(linkedin).toBeDefined();
    expect(linkedin!.inherited).toBe(true);
    expect(linkedin!.effectiveAt).toBe("2026-10-05T19:30:00.000Z");
  });

  it("marks a version that carries its own time as not inherited", async () => {
    const { cards } = await calendarPosts(staff, { clientId: clientA, ...october().range });
    const instagram = cards.find((card) => card.provider === "INSTAGRAM");

    expect(instagram!.inherited).toBe(false);
    expect(instagram!.effectiveAt).toBe("2026-10-05T14:00:00.000Z");
  });

  it("leaves out a version scheduled beyond the period", async () => {
    const { cards } = await calendarPosts(staff, { clientId: clientA, ...october().range });
    expect(cards.map((card) => card.provider)).not.toContain("FACEBOOK");
  });

  it("includes the borrowed days a month grid draws, so no cell is silently empty", async () => {
    // October 2026 draws Mon 28 Sep to Sun 8 Nov. A post on 3 Nov has a cell,
    // so it must have a card — the range has to cover what the grid renders,
    // not just the month.
    const { cards } = await calendarPosts(staff, { clientId: clientA, ...october().range });
    expect(cards.map((card) => card.provider)).toContain("X");
  });

  it("holds the list view to the month proper, where there are no borrowed days", async () => {
    const list = buildGrid("list", parseAnchor("2026-10", IST), IST, new Date("2026-10-08T06:00:00Z"));
    const { cards } = await calendarPosts(staff, { clientId: clientA, ...list.range });
    expect(cards.map((card) => card.provider)).not.toContain("X");
    expect(cards.map((card) => card.provider)).toContain("INSTAGRAM");
  });

  it("leaves out a version with no date at all", async () => {
    const { cards } = await calendarPosts(staff, { clientId: clientA, ...october().range });
    expect(cards.every((card) => card.effectiveAt !== null)).toBe(true);
  });

  it("carries the idea's campaign, project, owner and stage onto the card", async () => {
    const { cards } = await calendarPosts(staff, { clientId: clientA, ...october().range });
    const card = cards.find((row) => row.provider === "INSTAGRAM")!;

    expect(card.campaign?.id).toBe(campaignA);
    expect(card.project?.id).toBe(projectA);
    expect(card.owner?.id).toBe(userId);
    expect(card.stage).toBe("CLIENT_REVIEW");
    expect(card.title).toBe(`${SUFFIX} Diwali launch`);
  });

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  it("filters by platform", async () => {
    const { cards } = await calendarPosts(staff, {
      clientId: clientA,
      ...october().range,
      provider: "LINKEDIN",
    });
    expect(cards.map((card) => card.provider)).toEqual(["LINKEDIN"]);
  });

  it("filters by the idea's stage, campaign, project and owner", async () => {
    const range = october().range;
    const byStage = await calendarPosts(staff, { clientId: clientA, ...range, stage: "CLIENT_REVIEW" });
    const byOtherStage = await calendarPosts(staff, { clientId: clientA, ...range, stage: "IDEA" });
    const byCampaign = await calendarPosts(staff, { clientId: clientA, ...range, campaignId: campaignA });
    const byProject = await calendarPosts(staff, { clientId: clientA, ...range, projectId: projectA });
    const byOwner = await calendarPosts(staff, { clientId: clientA, ...range, ownerId: userId });

    // Three inside the drawn grid: Instagram and LinkedIn in October, X on
    // the borrowed 3 Nov. The 20 Nov post is outside it.
    expect(byStage.cards).toHaveLength(3);
    expect(byOtherStage.cards).toHaveLength(0);
    expect(byCampaign.cards).toHaveLength(3);
    expect(byProject.cards).toHaveLength(3);
    expect(byOwner.cards).toHaveLength(3);
  });

  it("keeps the inherited version when a filter on the idea is applied", async () => {
    // The OR that finds inherited dates and the filter on the idea have to
    // combine, not cancel: this is the case that breaks if they are merged
    // into one relation filter.
    const { cards } = await calendarPosts(staff, {
      clientId: clientA,
      ...october().range,
      campaignId: campaignA,
      provider: "LINKEDIN",
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]!.inherited).toBe(true);
  });

  it("filters by the version's own status", async () => {
    const { cards } = await calendarPosts(staff, {
      clientId: clientA,
      ...october().range,
      status: "SCHEDULED",
    });
    expect(cards.map((card) => card.provider)).toEqual(["INSTAGRAM"]);
  });

  // -------------------------------------------------------------------------
  // Unscheduled
  // -------------------------------------------------------------------------

  it("lists versions with no date anywhere, separately from the grid", async () => {
    const cards = await unscheduledPosts(staff, { clientId: clientA });
    expect(cards.map((card) => card.title)).toEqual([`${SUFFIX} Someday`]);
    expect(cards[0]!.effectiveAt).toBeNull();
  });

  it("applies the grid's filters to the undated panel too", async () => {
    // The undated version is Instagram. Filtering the calendar to LinkedIn has
    // to empty this panel as well, or the filter looks like it did not take.
    const instagram = await unscheduledPosts(staff, { clientId: clientA, provider: "INSTAGRAM" });
    const linkedin = await unscheduledPosts(staff, { clientId: clientA, provider: "LINKEDIN" });

    expect(instagram).toHaveLength(1);
    expect(linkedin).toHaveLength(0);
  });

  it("keeps the undated panel undated when an idea-level filter is applied", async () => {
    // The idea-level filter must not overwrite the `scheduledFor: null` clause
    // that defines this panel — that would pull dated work into it.
    const cards = await unscheduledPosts(staff, { clientId: clientA, projectId: projectA });
    expect(cards.map((card) => card.title)).toEqual([`${SUFFIX} Someday`]);
  });

  // -------------------------------------------------------------------------
  // Isolation
  // -------------------------------------------------------------------------

  it("shows another client nothing", async () => {
    const { cards } = await calendarPosts(staff, { clientId: clientB, ...october().range });
    expect(cards).toHaveLength(0);
  });

  it("refuses a portal user who names a client that is not theirs", async () => {
    await expect(
      calendarPosts(portal, { clientId: clientA, ...october().range }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(unscheduledPosts(portal, { clientId: clientA })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("scopes a portal user to their own client when they name none", async () => {
    const { cards } = await calendarPosts(portal, { clientId: null, ...october().range });
    expect(cards).toHaveLength(0);
  });

  it("refuses an actor without social.view", async () => {
    const blind = staffWith(userId, []);
    await expect(
      calendarPosts(blind, { clientId: clientA, ...october().range }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
