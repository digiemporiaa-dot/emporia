import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  portalPublished,
  portalSocialApprovals,
  portalSocialCalendar,
  portalSocialOverview,
} from "@/lib/services/portal-social.service";
import type { PortalActor } from "@/lib/actor/types";

/**
 * The client's social section in the portal (brief §16).
 *
 * Pinned: scoped by the session's client only; nothing before client review
 * (ideas, drafts, internal review) is ever shown; a failed attempt reads as
 * "delayed", never as a platform error; cancelled posts are hidden; months are
 * India time; and a card carries nothing internal — no account, no token, no
 * note.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `pso${Date.now()}`;

describeDb("portal social", () => {
  let userId = "";
  let clientA = "";
  let clientB = "";
  let projectA = "";
  let projectB = "";
  let portalA: PortalActor;
  let portalB: PortalActor;
  const ids: Record<string, string> = {};

  const portal = (clientId: string): PortalActor => ({
    userId,
    type: "CLIENT",
    name: "Client",
    email: "c@example.com",
    roleName: "CLIENT_USER",
    roleId: null,
    clientId,
    permissions: new Set<string>(),
    ip: null,
    userAgent: "vitest",
  });

  async function post(
    key: string,
    stage: "DRAFT" | "INTERNAL_REVIEW" | "CLIENT_REVIEW" | "APPROVED" | "SCHEDULED" | "PUBLISHED",
    status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED" | "CANCELLED",
    at: string,
    clientId = clientA,
  ) {
    const item = await db.contentCalendarItem.create({
      data: { clientId, projectId: clientId === clientA ? projectA : projectB, title: `${TAG} ${key}`, channel: "INSTAGRAM", stage, scheduledFor: new Date(at) },
      select: { id: true },
    });
    const created = await db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId,
        provider: "INSTAGRAM",
        type: "REEL",
        status,
        scheduledFor: new Date(at),
        publishedAt: status === "PUBLISHED" ? new Date(at) : null,
        externalUrl: status === "PUBLISHED" ? "https://instagram.example/p" : null,
        lastError: status === "FAILED" ? "Graph API error 190: token expired" : null,
      },
      select: { id: true },
    });
    ids[key] = created.id;
    return { itemId: item.id, postId: created.id };
  }

  beforeAll(async () => {
    userId = (await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } })).id;
    const [a, b] = await Promise.all(
      ["A", "B"].map((k) => db.client.create({ data: { name: `${TAG} ${k}`, slug: `${TAG}-${k.toLowerCase()}` }, select: { id: true } })),
    );
    clientA = a!.id;
    clientB = b!.id;
    const [pa, pb] = await Promise.all(
      [clientA, clientB].map((clientId, i) =>
        db.project.create({ data: { code: `${i ? "Q" : "P"}-${TAG}`.slice(0, 20), name: "Retainer", clientId, managerId: userId, startsAt: new Date(), status: "ACTIVE" }, select: { id: true } }),
      ),
    );
    projectA = pa!.id;
    projectB = pb!.id;
    portalA = portal(clientA);
    portalB = portal(clientB);

    // October 2026, India time.
    await post("draft", "DRAFT", "DRAFT", "2026-10-05T06:00:00Z");
    await post("internal", "INTERNAL_REVIEW", "DRAFT", "2026-10-06T06:00:00Z");
    const review = await post("review", "CLIENT_REVIEW", "DRAFT", "2026-10-07T06:00:00Z");
    await post("approved", "APPROVED", "DRAFT", "2026-10-08T06:00:00Z");
    await post("scheduled", "APPROVED", "SCHEDULED", "2026-10-09T06:00:00Z");
    await post("failed", "APPROVED", "FAILED", "2026-10-10T06:00:00Z");
    await post("cancelled", "APPROVED", "CANCELLED", "2026-10-11T06:00:00Z");
    await post("published", "PUBLISHED", "PUBLISHED", "2026-10-12T06:00:00Z");
    // 31 Oct 20:00 UTC is 1 Nov in India.
    await post("november", "PUBLISHED", "PUBLISHED", "2026-10-31T20:00:00Z");
    // Another client's, on the same day.
    await post("other", "PUBLISHED", "PUBLISHED", "2026-10-12T06:00:00Z", clientB);

    await db.approval.create({ data: { clientId: clientA, contentItemId: review.itemId, title: "Social", requestedById: userId, status: "PENDING" } });
    const blog = await db.contentCalendarItem.create({
      data: { clientId: clientA, projectId: projectA, title: `${TAG} blog`, channel: "BLOG", stage: "CLIENT_REVIEW" },
      select: { id: true },
    });
    await db.approval.create({ data: { clientId: clientA, contentItemId: blog.id, title: "Blog", requestedById: userId, status: "PENDING" } });
  });

  afterAll(async () => {
    await db.approval.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  it("shows the month from client review on, and never ideas, drafts or internal review", async () => {
    const cards = await portalSocialCalendar(portalA, { year: 2026, month: 10 });
    const byId = new Map(cards.map((c) => [c.id, c]));
    expect(byId.has(ids["draft"]!)).toBe(false);
    expect(byId.has(ids["internal"]!)).toBe(false);
    expect(byId.has(ids["cancelled"]!)).toBe(false);
    expect(byId.has(ids["november"]!)).toBe(false);
    expect(byId.has(ids["other"]!)).toBe(false);
    expect(byId.get(ids["review"]!)?.state).toBe("IN_REVIEW");
    expect(byId.get(ids["approved"]!)?.state).toBe("APPROVED");
    expect(byId.get(ids["scheduled"]!)?.state).toBe("SCHEDULED");
    expect(byId.get(ids["published"]!)?.state).toBe("PUBLISHED");
    // A failed attempt is "delayed" — the platform's error stays with the agency.
    expect(byId.get(ids["failed"]!)?.state).toBe("DELAYED");
    expect(JSON.stringify(cards)).not.toContain("token expired");
    expect((await portalSocialCalendar(portalA, { year: 2026, month: 11 })).map((c) => c.id)).toEqual([ids["november"]]);
  });

  it("carries nothing internal on a card", async () => {
    const [card] = await portalSocialCalendar(portalA, { year: 2026, month: 10 });
    expect(Object.keys(card!).sort()).toEqual(["at", "campaign", "externalUrl", "id", "provider", "state", "thumbnail", "title", "type"]);
  });

  it("keeps each client to their own posts, approvals and figures", async () => {
    const b = await portalSocialCalendar(portalB, { year: 2026, month: 10 });
    expect(b.map((c) => c.id)).toEqual([ids["other"]]);
    expect((await portalPublished(portalB, 1)).posts.map((p) => p.id)).toEqual([ids["other"]]);
    expect((await portalSocialApprovals(portalB)).pending).toEqual([]);
  });

  it("lists social approvals only, and counts them on the overview", async () => {
    const { pending } = await portalSocialApprovals(portalA);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.contentItem?.title).toBe(`${TAG} review`);
    const overview = await portalSocialOverview(portalA, new Date("2026-10-08T00:00:00Z"));
    expect(overview.pendingApprovals).toBe(1);
    expect(overview.upcoming.map((c) => c.id)).toEqual([ids["scheduled"]]);
    expect(overview.month.posts).toBe(1);
    expect(overview.latestReport).toBeNull();
  });

  it("pages published posts newest first", async () => {
    const list = await portalPublished(portalA, 1);
    expect(list.total).toBe(2);
    expect(list.posts.map((p) => p.id)).toEqual([ids["november"], ids["published"]]);
    expect(list.posts[0]).toMatchObject({ engagement: null, reach: null, rate: null, externalUrl: "https://instagram.example/p" });
  });
});
