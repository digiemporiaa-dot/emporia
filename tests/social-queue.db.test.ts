import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  queueCounts,
  resolveStrandedPost,
  retryAllFailed,
  socialQueue,
  STUCK_AFTER_MS,
} from "@/lib/services/social-queue.service";
import { MAX_ATTEMPTS } from "@/lib/social/idempotency";
import type { Actor } from "@/lib/actor/types";

/**
 * The publishing queue.
 *
 * Most of this is about the stranded post — one claimed into PUBLISHING by a
 * process that then died. It is the case Phase 6 could not see, and the one
 * where guessing on an operator's behalf would put a duplicate on a client's
 * feed.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `q7-${Date.now()}`;
const ago = (ms: number) => new Date(Date.now() - ms);

function staffWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Operator",
    email: "operator@emporia.test",
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

describeDb("social publishing queue", () => {
  let staff: Actor;
  let portal: Actor;
  let clientA = "";
  let clientB = "";
  let projectA = "";
  let projectB = "";
  let userId = "";
  let counter = 0;

  async function post(over: {
    client?: string;
    status?: "SCHEDULED" | "FAILED" | "PUBLISHING" | "PUBLISHED";
    scheduledFor?: Date;
    lastAttemptAt?: Date | null;
    attemptCount?: number;
    publishedAt?: Date;
    provider?: "LINKEDIN" | "INSTAGRAM";
  } = {}) {
    counter += 1;
    const clientId = over.client ?? clientA;
    const item = await db.contentCalendarItem.create({
      data: {
        clientId,
        projectId: clientId === clientA ? projectA : projectB,
        title: `${SUFFIX} idea ${counter}`,
        channel: "LINKEDIN",
        stage: "APPROVED",
      },
      select: { id: true },
    });
    return db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId,
        provider: over.provider ?? "LINKEDIN",
        type: "TEXT",
        status: over.status ?? "SCHEDULED",
        caption: `Copy ${counter}.`,
        scheduledFor: over.scheduledFor ?? ago(60_000),
        lastAttemptAt: over.lastAttemptAt === undefined ? null : over.lastAttemptAt,
        attemptCount: over.attemptCount ?? 0,
        publishedAt: over.publishedAt ?? null,
      },
      select: { id: true },
    });
  }

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = user.id;
    staff = staffWith(user.id, ["social.view", "social.publish"]);

    const [a, b] = await Promise.all([
      db.client.create({ data: { name: `${SUFFIX} A`, slug: `${SUFFIX}-a` }, select: { id: true } }),
      db.client.create({ data: { name: `${SUFFIX} B`, slug: `${SUFFIX}-b` }, select: { id: true } }),
    ]);
    clientA = a.id;
    clientB = b.id;
    portal = {
      ...staffWith(user.id, ["social.view", "social.publish"]),
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

    const otherProject = await db.project.create({
      data: {
        code: `${SUFFIX}-B`.slice(0, 20),
        name: "B retainer",
        clientId: clientB,
        managerId: user.id,
        startsAt: new Date(),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    projectB = otherProject.id;
  });

  afterEach(async () => {
    await db.socialPublication.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
  });

  afterAll(async () => {
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  // -------------------------------------------------------------------------
  // The bands
  // -------------------------------------------------------------------------

  it("separates what is due from what is scheduled later", async () => {
    const dueNow = await post({ scheduledFor: ago(60_000) });
    const later = await post({ scheduledFor: new Date(Date.now() + 86_400_000) });

    const queue = await socialQueue(staff, { clientId: clientA });
    expect(queue.due.map((p) => p.id)).toContain(dueNow.id);
    expect(queue.upcoming.map((p) => p.id)).toContain(later.id);
    expect(queue.due.map((p) => p.id)).not.toContain(later.id);
  });

  it("separates a failure that will retry itself from one that needs a person", async () => {
    const willRetry = await post({ status: "FAILED", attemptCount: 1 });
    const needsPerson = await post({ status: "FAILED", attemptCount: MAX_ATTEMPTS });

    const queue = await socialQueue(staff, { clientId: clientA });
    expect(queue.retrying.map((p) => p.id)).toEqual([willRetry.id]);
    expect(queue.needsRetry.map((p) => p.id)).toEqual([needsPerson.id]);
  });

  it("shows a recently published post without showing an old one", async () => {
    const fresh = await post({ status: "PUBLISHED", publishedAt: ago(3_600_000) });
    const old = await post({ status: "PUBLISHED", publishedAt: ago(30 * 86_400_000) });

    const queue = await socialQueue(staff, { clientId: clientA });
    expect(queue.recent.map((p) => p.id)).toEqual([fresh.id]);
    expect(queue.recent.map((p) => p.id)).not.toContain(old.id);
  });

  it("filters by platform", async () => {
    await post({ provider: "LINKEDIN" });
    const insta = await post({ provider: "INSTAGRAM" });

    const queue = await socialQueue(staff, { clientId: clientA, provider: "INSTAGRAM" });
    expect(queue.due.map((p) => p.id)).toEqual([insta.id]);
  });

  // -------------------------------------------------------------------------
  // Stranded posts
  // -------------------------------------------------------------------------

  it("calls a post stranded once it has sat in publishing too long", async () => {
    const stuck = await post({
      status: "PUBLISHING",
      lastAttemptAt: ago(STUCK_AFTER_MS + 60_000),
    });

    const queue = await socialQueue(staff, { clientId: clientA });
    expect(queue.stranded.map((p) => p.id)).toEqual([stuck.id]);
    expect(queue.inFlight).toHaveLength(0);
  });

  it("leaves a publication that is genuinely still running alone", async () => {
    const running = await post({ status: "PUBLISHING", lastAttemptAt: ago(30_000) });

    const queue = await socialQueue(staff, { clientId: clientA });
    expect(queue.inFlight.map((p) => p.id)).toEqual([running.id]);
    expect(queue.stranded).toHaveLength(0);
  });

  it("treats a publishing post with no attempt time as stranded", async () => {
    // The shape a pre-Phase-7 row can have: claimed before the claim stamped
    // a time, then interrupted.
    const stuck = await post({ status: "PUBLISHING", lastAttemptAt: null });
    const queue = await socialQueue(staff, { clientId: clientA });
    expect(queue.stranded.map((p) => p.id)).toEqual([stuck.id]);
  });

  it("records a stranded post as published when a person confirms it went out", async () => {
    const stuck = await post({
      status: "PUBLISHING",
      lastAttemptAt: ago(STUCK_AFTER_MS + 60_000),
    });
    await db.socialPublication.create({
      data: {
        postId: stuck.id,
        clientId: clientA,
        provider: "LINKEDIN",
        status: "PUBLISHING",
        idempotencyKey: `post:${stuck.id}:1`,
        attempt: 1,
      },
    });

    await resolveStrandedPost(staff, stuck.id, {
      outcome: "published",
      externalUrl: "https://www.linkedin.com/feed/update/urn:li:share:1",
    });

    const row = await db.socialPost.findUniqueOrThrow({
      where: { id: stuck.id },
      select: { status: true, externalUrl: true, publishedAt: true },
    });
    expect(row.status).toBe("PUBLISHED");
    expect(row.externalUrl).toContain("linkedin.com");
    expect(row.publishedAt).not.toBeNull();

    // The open attempt is closed rather than left hanging.
    const publication = await db.socialPublication.findFirstOrThrow({
      where: { postId: stuck.id },
      select: { status: true, completedAt: true },
    });
    expect(publication.status).toBe("PUBLISHED");
    expect(publication.completedAt).not.toBeNull();
  });

  it("puts a stranded post back in the queue when it never went out", async () => {
    const stuck = await post({
      status: "PUBLISHING",
      lastAttemptAt: ago(STUCK_AFTER_MS + 60_000),
    });

    await resolveStrandedPost(staff, stuck.id, { outcome: "not-published" });

    const row = await db.socialPost.findUniqueOrThrow({
      where: { id: stuck.id },
      select: { status: true, lastError: true },
    });
    expect(row.status).toBe("FAILED");
    expect(row.lastError).toContain("interrupted");
  });

  it("refuses to resolve a publication that could still be running", async () => {
    const running = await post({ status: "PUBLISHING", lastAttemptAt: ago(30_000) });

    // The critical refusal: calling a live publication stranded is how the
    // duplicate this design avoids gets created.
    await expect(
      resolveStrandedPost(staff, running.id, { outcome: "not-published" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses to resolve a post that is not stuck at all", async () => {
    const scheduled = await post();
    await expect(
      resolveStrandedPost(staff, scheduled.id, { outcome: "not-published" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses a link that is not a link", async () => {
    const stuck = await post({
      status: "PUBLISHING",
      lastAttemptAt: ago(STUCK_AFTER_MS + 60_000),
    });
    await expect(
      resolveStrandedPost(staff, stuck.id, { outcome: "published", externalUrl: "not a url" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses an operator without social.publish", async () => {
    const stuck = await post({
      status: "PUBLISHING",
      lastAttemptAt: ago(STUCK_AFTER_MS + 60_000),
    });
    const viewer = staffWith(userId, ["social.view"]);
    await expect(
      resolveStrandedPost(viewer, stuck.id, { outcome: "not-published" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // -------------------------------------------------------------------------
  // Scope
  // -------------------------------------------------------------------------

  it("spans clients for staff who name none", async () => {
    await post({ client: clientA });
    await post({ client: clientB });

    const queue = await socialQueue(staff, { clientId: null });
    const clients = new Set(queue.due.map((p) => p.clientId));
    expect(clients.has(clientA)).toBe(true);
    expect(clients.has(clientB)).toBe(true);
  });

  it("narrows to one client when staff name one", async () => {
    await post({ client: clientA });
    await post({ client: clientB });

    const queue = await socialQueue(staff, { clientId: clientA });
    expect(queue.due.every((p) => p.clientId === clientA)).toBe(true);
  });

  it("never spans clients for a portal user, even naming none", async () => {
    await post({ client: clientA });
    await post({ client: clientB });

    const queue = await socialQueue(portal, { clientId: null });
    expect(queue.due.every((p) => p.clientId === clientB)).toBe(true);
    expect(queue.due.some((p) => p.clientId === clientA)).toBe(false);
  });

  it("refuses a portal user who names another client", async () => {
    await expect(socialQueue(portal, { clientId: clientA })).rejects.toBeInstanceOf(ForbiddenError);
  });

  // -------------------------------------------------------------------------
  // Counts and bulk retry
  // -------------------------------------------------------------------------

  it("counts what the header shows", async () => {
    await post({ status: "PUBLISHING", lastAttemptAt: ago(STUCK_AFTER_MS + 60_000) });
    await post({ status: "FAILED", attemptCount: 1 });
    await post({ scheduledFor: ago(60_000) });
    await post({ scheduledFor: new Date(Date.now() + 86_400_000) });

    const counts = await queueCounts(staff, { clientId: clientA });
    expect(counts).toEqual({ stranded: 1, failed: 1, due: 1, upcoming: 1 });
  });

  it("reports each failure separately when retrying in bulk", async () => {
    // Neither has an account, so both fail for a reason the operator can read
    // rather than the batch collapsing on the first one.
    await post({ status: "FAILED", attemptCount: 1 });
    await post({ status: "FAILED", attemptCount: 1 });

    const result = await retryAllFailed(staff, { clientId: clientA });
    expect(result.attempted).toBe(2);
    expect(result.published).toBe(0);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]!.reason).toContain("account");
  });

  it("refuses bulk retry without social.publish", async () => {
    const viewer = staffWith(userId, ["social.view"]);
    await expect(retryAllFailed(viewer, { clientId: clientA })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
