import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { listContentItems, getContentItem } from "@/lib/services/social-content.service";
import { calendarPosts, unscheduledPosts } from "@/lib/services/social-calendar.service";
import { socialQueue, queueCounts } from "@/lib/services/social-queue.service";
import { socialApprovalFor } from "@/lib/services/social-approval.service";
import { socialReport } from "@/lib/services/social-metrics.service";
import { socialReport as portalSocialReport } from "@/lib/services/portal.service";
import { listPostsForItem } from "@/lib/services/social-post.service";
import { publicationsFor } from "@/lib/services/social-publish.service";
import { resolveRange } from "@/lib/analytics/range";
import type { Actor, PortalActor } from "@/lib/actor/types";

/**
 * A sweep across every social read, for the module's hardest requirement.
 *
 * Distinct from `social-isolation.db.test.ts`, which proves the same property
 * deeply for accounts and credentials — the two things the module cannot ship
 * without. This one goes wide instead of deep: it walks **every** social read
 * that takes a client and asserts the same thing about all of them at once.
 *
 * "A user working on Client A must never see or modify Client B's social
 * accounts, content, approvals or analytics." Every phase tested its own
 * corner of that; this walks **every social read that takes a client** and
 * asserts the same thing about all of them at once.
 *
 * The value is in the shape, not any single assertion: a later phase that adds
 * a read and forgets to scope it should fail here, in a file whose whole
 * subject is isolation, rather than slipping through because its own test file
 * only ever used one client.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const SUFFIX = `swp12-${Date.now()}`;

/** Every social permission there is, so nothing passes for want of one. */
const ALL_SOCIAL = [
  "social.view",
  "social.create",
  "social.edit",
  "social.delete",
  "social.approve",
  "social.publish",
  "social.accounts.manage",
  "social.analytics.view",
  "social.reports.view",
];

describeDb("client isolation across the social module", () => {
  let clientA = "";
  let clientB = "";
  let itemA = "";
  let postA = "";
  let portalB: PortalActor;
  let staff: Actor;

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

    staff = { ...base, type: "STAFF", roleName: "ADMIN", clientId: null, permissions: new Set(ALL_SOCIAL) };
    // A portal user of B, holding every social permission a staff member could.
    // Permissions must not be what keeps them out — the scope must be.
    portalB = {
      ...base,
      type: "CLIENT",
      roleName: "CLIENT_USER",
      clientId: clientB,
      permissions: new Set(ALL_SOCIAL),
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

    const item = await db.contentCalendarItem.create({
      data: {
        clientId: clientA,
        projectId: project.id,
        title: `${SUFFIX} A's private idea`,
        channel: "LINKEDIN",
        stage: "APPROVED",
        scheduledFor: new Date(),
      },
      select: { id: true },
    });
    itemA = item.id;

    const post = await db.socialPost.create({
      data: {
        contentItemId: itemA,
        clientId: clientA,
        provider: "LINKEDIN",
        type: "TEXT",
        status: "PUBLISHED",
        caption: "A's private copy.",
        publishedAt: new Date(),
        scheduledFor: new Date(),
      },
      select: { id: true },
    });
    postA = post.id;

    await db.socialMetricSnapshot.create({
      data: {
        postId: postA,
        clientId: clientA,
        capturedOn: new Date(new Date().toISOString().slice(0, 10)),
        likes: 999,
      },
    });

    await db.approval.create({
      data: {
        clientId: clientA,
        contentItemId: itemA,
        title: "A's approval",
        status: "PENDING",
        requestedById: user.id,
      },
    });
  });

  afterAll(async () => {
    await db.approval.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialMetricSnapshot.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialPublication.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  /** Refused outright, or returned empty. Both are correct; leaking is not. */
  async function refusedOrEmpty(what: string, run: () => Promise<unknown>) {
    let result: unknown;
    try {
      result = await run();
    } catch (error) {
      expect(isAppError(error), `${what} threw something that is not an AppError`).toBe(true);
      return;
    }
    const json = JSON.stringify(result ?? null);
    expect(json, `${what} leaked client A's data`).not.toContain("A's private");
    expect(json, `${what} leaked client A's data`).not.toContain(itemA);
    expect(json, `${what} leaked client A's data`).not.toContain("999");
  }

  // -------------------------------------------------------------------------
  // Naming another client explicitly
  // -------------------------------------------------------------------------

  it("refuses a portal user naming another client, on every read that takes one", async () => {
    const range = resolveRange("all");
    const window = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };

    await refusedOrEmpty("listContentItems", () => listContentItems(portalB, { clientId: clientA }));
    await refusedOrEmpty("calendarPosts", () => calendarPosts(portalB, { clientId: clientA, ...window }));
    await refusedOrEmpty("unscheduledPosts", () => unscheduledPosts(portalB, { clientId: clientA }));
    await refusedOrEmpty("socialQueue", () => socialQueue(portalB, { clientId: clientA }));
    await refusedOrEmpty("queueCounts", () => queueCounts(portalB, { clientId: clientA }));
    await refusedOrEmpty("socialReport", () =>
      socialReport(portalB, { clientId: clientA, from: range.from, to: range.to }),
    );
  });

  it("refuses a portal user reaching for another client's record by its id", async () => {
    await refusedOrEmpty("getContentItem", () => getContentItem(portalB, itemA));
    await refusedOrEmpty("listPostsForItem", () => listPostsForItem(portalB, itemA));
    await refusedOrEmpty("socialApprovalFor", () => socialApprovalFor(portalB, itemA));
    await refusedOrEmpty("publicationsFor", () => publicationsFor(portalB, postA));
  });

  // -------------------------------------------------------------------------
  // Naming nothing at all — the quieter failure
  // -------------------------------------------------------------------------

  it("scopes a portal user to their own client when they name none", async () => {
    const range = resolveRange("all");
    const window = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };

    // This is the one that matters most: a screen that spans clients for staff
    // must not span them for a client just because nothing was named.
    await refusedOrEmpty("socialQueue (unnamed)", () => socialQueue(portalB, { clientId: null }));
    await refusedOrEmpty("queueCounts (unnamed)", () => queueCounts(portalB, { clientId: null }));
    await refusedOrEmpty("calendarPosts (unnamed)", () =>
      calendarPosts(portalB, { clientId: null, ...window }),
    );
    await refusedOrEmpty("socialReport (unnamed)", () =>
      socialReport(portalB, { clientId: null, from: range.from, to: range.to }),
    );
    await refusedOrEmpty("portal report", () => portalSocialReport(portalB, range));
  });

  // -------------------------------------------------------------------------
  // The control: staff genuinely can see it
  // -------------------------------------------------------------------------

  it("still lets staff see the client they asked for", async () => {
    // Without this the tests above would pass on a module that shows nobody
    // anything.
    const items = await listContentItems(staff, { clientId: clientA });
    expect(items.map((item) => item.id)).toContain(itemA);

    const report = await socialReport(staff, {
      clientId: clientA,
      from: resolveRange("all").from,
      to: resolveRange("all").to,
    });
    expect(report.totals.likes.value).toBe(999);
  });

  it("never leaks a token through any read, for anyone", async () => {
    const seen = JSON.stringify([
      await listContentItems(staff, { clientId: clientA }),
      await socialApprovalFor(staff, itemA),
      await listPostsForItem(staff, itemA),
      await publicationsFor(staff, postA),
    ]);

    for (const secret of ["accessToken", "refreshToken", "tokenExpiresAt"]) {
      expect(seen).not.toContain(secret);
    }
  });
});
