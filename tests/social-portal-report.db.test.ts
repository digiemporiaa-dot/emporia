import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { socialReport as portalReport } from "@/lib/services/portal.service";
import { socialReport as adminReport } from "@/lib/services/social-metrics.service";
import { resolveRange } from "@/lib/analytics/range";
import { totalsOf, engagementOf, isMeasured } from "@/lib/social/report";
import type { Actor, PortalActor } from "@/lib/actor/types";

/**
 * The client's own report.
 *
 * The rule here is that the agency's numbers and the client's numbers are the
 * same numbers. They come from one shared arithmetic module, and this file
 * asserts the two surfaces agree rather than trusting that they will.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const SUFFIX = `rep11-${Date.now()}`;

describe("report arithmetic", () => {
  const row = (over: Partial<Record<string, number | null>> = {}) =>
    ({
      postId: "p",
      provider: "LINKEDIN" as const,
      impressions: null,
      reach: null,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      clicks: null,
      videoViews: null,
      profileVisits: null,
      followersGained: null,
      ...over,
    }) as Parameters<typeof totalsOf>[0][number];

  it("totals a metric nobody reported to null, not zero", () => {
    const totals = totalsOf([row({ likes: 5 }), row({ likes: 3 })]);
    expect(totals.likes).toEqual({ value: 8, reporting: 2, total: 2 });
    expect(totals.impressions).toEqual({ value: null, reporting: 0, total: 2 });
  });

  it("counts only the rows that reported, not all of them", () => {
    const totals = totalsOf([row({ likes: 5 }), row(), row()]);
    expect(totals.likes).toEqual({ value: 5, reporting: 1, total: 3 });
  });

  it("distinguishes a measured zero from an unmeasured metric", () => {
    // A platform genuinely reporting zero likes is a measurement and must
    // survive as one.
    const totals = totalsOf([row({ likes: 0 })]);
    expect(totals.likes).toEqual({ value: 0, reporting: 1, total: 1 });
    expect(isMeasured(row({ likes: 0 }))).toBe(true);
    expect(isMeasured(row())).toBe(false);
  });

  it("sums engagement from what was reported only", () => {
    expect(engagementOf(row({ likes: 4, comments: 2 }))).toBe(6);
    expect(engagementOf(row())).toBe(0);
  });
});

describeDb("the client's social report", () => {
  let portal: PortalActor;
  let staff: Actor;
  let clientA = "";
  let clientB = "";
  let projectA = "";
  let projectB = "";
  let counter = 0;

  async function post(over: { client?: string; status?: "PUBLISHED" | "DRAFT"; likes?: number | null } = {}) {
    counter += 1;
    const clientId = over.client ?? clientA;
    const item = await db.contentCalendarItem.create({
      data: {
        clientId,
        projectId: clientId === clientA ? projectA : projectB,
        title: `${SUFFIX} idea ${counter}`,
        channel: "LINKEDIN",
        stage: "PUBLISHED",
      },
      select: { id: true },
    });
    const created = await db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId,
        provider: "LINKEDIN",
        type: "TEXT",
        status: over.status ?? "PUBLISHED",
        caption: "Copy.",
        publishedAt: over.status === "DRAFT" ? null : new Date(),
      },
      select: { id: true },
    });
    if (over.likes !== undefined && over.likes !== null) {
      await db.socialMetricSnapshot.create({
        data: {
          postId: created.id,
          clientId,
          capturedOn: new Date(new Date().toISOString().slice(0, 10)),
          likes: over.likes,
        },
      });
    }
    return created;
  }

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    const base = {
      userId: user.id,
      name: "Someone",
      email: "someone@emporia.test",
      roleId: null,
      ip: null,
      userAgent: "vitest",
    };

    const [a, b] = await Promise.all([
      db.client.create({ data: { name: `${SUFFIX} A`, slug: `${SUFFIX}-a` }, select: { id: true } }),
      db.client.create({ data: { name: `${SUFFIX} B`, slug: `${SUFFIX}-b` }, select: { id: true } }),
    ]);
    clientA = a.id;
    clientB = b.id;

    portal = {
      ...base,
      type: "CLIENT",
      roleName: "CLIENT_USER",
      clientId: clientA,
      permissions: new Set<string>(),
    };
    staff = {
      ...base,
      type: "STAFF",
      roleName: "MARKETING_MANAGER",
      clientId: null,
      permissions: new Set(["social.view", "social.analytics.view"]),
    };

    const project = await db.project.create({
      data: {
        code: `A-${SUFFIX}`.slice(0, 20),
        name: "A retainer",
        clientId: clientA,
        managerId: user.id,
        startsAt: new Date(),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    projectA = project.id;

    const other = await db.project.create({
      data: {
        code: `B-${SUFFIX}`.slice(0, 20),
        name: "B retainer",
        clientId: clientB,
        managerId: user.id,
        startsAt: new Date(),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    projectB = other.id;
  });

  afterEach(async () => {
    await db.socialMetricSnapshot.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
  });

  afterAll(async () => {
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  it("gives the client and the agency the same numbers", async () => {
    await post({ likes: 12 });
    await post({ likes: 8 });
    await post();

    const range = resolveRange("all");
    const mine = await portalReport(portal, range);
    const theirs = await adminReport(staff, { clientId: clientA, from: range.from, to: range.to });

    // The whole reason the arithmetic is one shared module.
    expect(mine.posts).toBe(theirs.posts);
    expect(mine.measured).toBe(theirs.measured);
    expect(mine.totals.likes).toEqual(theirs.totals.likes);
    expect(mine.totals.impressions.value).toBeNull();
  });

  it("shows the client nothing that was not published", async () => {
    await post({ status: "DRAFT" });
    const report = await portalReport(portal, resolveRange("all"));
    expect(report.posts).toBe(0);
  });

  it("never shows another client's posts", async () => {
    await post({ client: clientB, likes: 99 });
    const report = await portalReport(portal, resolveRange("all"));
    expect(report.posts).toBe(0);
    expect(report.totals.likes.value).toBeNull();
  });

  it("says a post was not reported rather than scoring it zero", async () => {
    await post();
    const report = await portalReport(portal, resolveRange("all"));
    expect(report.recent[0]!.engagement).toBeNull();
  });

  it("gives a measured post its real engagement", async () => {
    await post({ likes: 7 });
    const report = await portalReport(portal, resolveRange("all"));
    expect(report.recent[0]!.engagement).toBe(7);
  });

  it("tells the client which platforms cannot report", async () => {
    await post({ likes: 3 });
    const report = await portalReport(portal, resolveRange("all"));
    expect(report.byProvider[0]!.reportsMetrics).toBe(true);
  });
});
