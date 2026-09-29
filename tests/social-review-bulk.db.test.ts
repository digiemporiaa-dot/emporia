import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  decideInternalReview,
  internalReviewsFor,
  latestReviewStatuses,
  submitForInternalReview,
  withdrawInternalReview,
} from "@/lib/services/social-review.service";
import { requestSocialApproval } from "@/lib/services/social-approval.service";
import { deletePost, reschedulePost, savePost, setPostStatus } from "@/lib/services/social-post.service";
import { decideApproval } from "@/lib/services/portal.service";
import { setContentStage } from "@/lib/services/delivery-content.service";
import { runBulkAction } from "@/lib/services/social-bulk.service";
import { socialPostSchema } from "@/lib/validation/social";
import { encryptSecret } from "@/lib/security/secret";
import type { Actor, PortalActor } from "@/lib/actor/types";

/**
 * Internal review and bulk actions.
 *
 * Pinned — internal review: mandatory before the client (nothing is sent from
 * draft, while a round waits, or after changes were asked for); decided only
 * by someone holding `social.review`, with feedback required to send work back
 * or reject it; rounds kept with what they contained; an edit withdraws a
 * waiting round; an approval covers the content as it stood, so a later edit
 * needs a new round — while a reschedule, by the agency's rule, needs none and
 * keeps the client's approval too. Internal rounds never reach a portal user.
 * The general content board can no longer mark social work approved.
 *
 * Bulk: each action is the single-item service per item, reported per item —
 * another client's idea is "not found", an idea that is not ready says why,
 * and one failure does not stop the rest.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const SUFFIX = `rvb-${Date.now()}`;

function staff(userId: string, permissions: string[], name = "Editor"): Actor {
  return {
    userId,
    name,
    email: `${name.toLowerCase()}@emporia.test`,
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const EDIT = ["social.view", "social.create", "social.edit", "social.delete", "social.approve"];
const future = (days: number, hourUtc = 14) => {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + days);
  at.setUTCHours(hourUtc, 0, 0, 0);
  return at;
};

describeDb("internal review and bulk actions", () => {
  let userId = "";
  let otherUserId = "";
  let writer: Actor;
  let reviewer: Actor;
  let portalA: PortalActor;
  let clientA = "";
  let clientB = "";
  let projectA = "";
  let projectB = "";
  let accountA = "";

  /** A draft idea with one written LinkedIn version, on an account, at a future time. */
  async function makeItem(title: string, clientId = clientA, projectId = projectA) {
    const item = await db.contentCalendarItem.create({
      data: { clientId, projectId, title: `${SUFFIX} ${title}`, channel: "LINKEDIN", stage: "DRAFT", scheduledFor: future(5) },
      select: { id: true },
    });
    const post = await savePost(
      writer,
      null,
      socialPostSchema.parse({
        contentItemId: item.id,
        provider: "LINKEDIN",
        type: "TEXT",
        caption: `The ${title} post.`,
        accountId: clientId === clientA ? accountA : null,
        scheduledFor: future(5),
      }),
    );
    return { itemId: item.id, postId: post.id };
  }

  async function approveInternally(itemId: string) {
    await submitForInternalReview(writer, { contentItemId: itemId, note: null });
    await decideInternalReview(reviewer, { contentItemId: itemId, decision: "APPROVED", feedback: null });
  }

  /** Through internal review and the client's approval. */
  async function clientApproved(title: string) {
    const made = await makeItem(title);
    await approveInternally(made.itemId);
    const { approvalId } = await requestSocialApproval(writer, { contentItemId: made.itemId, note: null });
    await decideApproval(portalA, approvalId, "APPROVED", null);
    return made;
  }

  async function saveCaption(itemId: string, postId: string, caption: string, scheduledFor = future(5)) {
    return savePost(
      writer,
      postId,
      socialPostSchema.parse({ contentItemId: itemId, provider: "LINKEDIN", type: "TEXT", caption, accountId: accountA, scheduledFor }),
    );
  }

  const stageOf = async (id: string) => (await db.contentCalendarItem.findUniqueOrThrow({ where: { id }, select: { stage: true } })).stage;

  beforeAll(async () => {
    const users = await db.user.findMany({ where: { type: "STAFF" }, take: 2, select: { id: true } });
    userId = users[0]!.id;
    otherUserId = users[1]?.id ?? users[0]!.id;
    writer = staff(userId, EDIT, "Writer");
    reviewer = staff(otherUserId, ["social.view", "social.review"], "Reviewer");

    const [a, b] = await Promise.all([
      db.client.create({ data: { name: `${SUFFIX} A`, slug: `${SUFFIX}-a` }, select: { id: true } }),
      db.client.create({ data: { name: `${SUFFIX} B`, slug: `${SUFFIX}-b` }, select: { id: true } }),
    ]);
    clientA = a.id;
    clientB = b.id;
    const [pa, pb] = await Promise.all(
      [clientA, clientB].map((clientId, i) =>
        db.project.create({
          data: { code: `${i ? "Q" : "P"}-${SUFFIX}`.slice(0, 20), name: "Retainer", clientId, managerId: userId, startsAt: new Date(), status: "ACTIVE" },
          select: { id: true },
        }),
      ),
    );
    projectA = pa!.id;
    projectB = pb!.id;
    accountA = (
      await db.socialAccount.create({
        data: {
          clientId: clientA,
          provider: "LINKEDIN",
          externalId: `${SUFFIX}-member`,
          name: "A on LinkedIn",
          status: "CONNECTED",
          accessToken: encryptSecret("token"),
          connectedById: userId,
        },
        select: { id: true },
      })
    ).id;
    portalA = {
      userId,
      type: "CLIENT",
      name: "Client A",
      email: "client-a@example.com",
      roleName: "CLIENT_USER",
      roleId: null,
      clientId: clientA,
      permissions: new Set<string>(),
      ip: null,
      userAgent: "vitest",
    };
  });

  afterEach(async () => {
    await db.approval.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
  });

  afterAll(async () => {
    await db.socialAccount.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  // -------------------------------------------------------------------------
  // Internal review
  // -------------------------------------------------------------------------

  it("will not send to the client from draft, while waiting, or after changes were asked for", async () => {
    const { itemId } = await makeItem("gate");
    await expect(requestSocialApproval(writer, { contentItemId: itemId, note: null })).rejects.toBeInstanceOf(ValidationError);

    await submitForInternalReview(writer, { contentItemId: itemId, note: "Check the tone." });
    expect(await stageOf(itemId)).toBe("INTERNAL_REVIEW");
    await expect(requestSocialApproval(writer, { contentItemId: itemId, note: null })).rejects.toThrow(/waiting for internal review/);

    await decideInternalReview(reviewer, { contentItemId: itemId, decision: "CHANGES_REQUESTED", feedback: "Too formal." });
    expect(await stageOf(itemId)).toBe("DRAFT");
    await expect(requestSocialApproval(writer, { contentItemId: itemId, note: null })).rejects.toBeInstanceOf(ValidationError);

    await submitForInternalReview(writer, { contentItemId: itemId, note: null });
    await decideInternalReview(reviewer, { contentItemId: itemId, decision: "APPROVED", feedback: null });
    await expect(requestSocialApproval(writer, { contentItemId: itemId, note: null })).resolves.toBeDefined();
    expect(await stageOf(itemId)).toBe("CLIENT_REVIEW");
  });

  it("needs the review permission, and feedback to send back or reject", async () => {
    const { itemId } = await makeItem("perm");
    await submitForInternalReview(writer, { contentItemId: itemId, note: null });
    await expect(
      decideInternalReview(writer, { contentItemId: itemId, decision: "APPROVED", feedback: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      decideInternalReview(reviewer, { contentItemId: itemId, decision: "REJECTED", feedback: " " }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      decideInternalReview(reviewer, { contentItemId: itemId, decision: "CHANGES_REQUESTED", feedback: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    await decideInternalReview(reviewer, { contentItemId: itemId, decision: "REJECTED", feedback: "Off-brand." });
    const round = await db.socialInternalReview.findFirstOrThrow({ where: { contentItemId: itemId } });
    expect(round).toMatchObject({ status: "REJECTED", feedback: "Off-brand.", reviewerId: otherUserId });
    expect(round.decidedAt).not.toBeNull();
  });

  it("lets someone holding the review permission approve their own submission", async () => {
    const { itemId } = await makeItem("self");
    const both = staff(userId, [...EDIT, "social.review"]);
    await submitForInternalReview(both, { contentItemId: itemId, note: null });
    await expect(
      decideInternalReview(both, { contentItemId: itemId, decision: "APPROVED", feedback: null }),
    ).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("refuses a second submission while one waits, and a second decision on one round", async () => {
    const { itemId } = await makeItem("twice");
    await submitForInternalReview(writer, { contentItemId: itemId, note: null });
    await expect(submitForInternalReview(writer, { contentItemId: itemId, note: null })).rejects.toBeInstanceOf(ConflictError);

    const results = await Promise.allSettled([
      decideInternalReview(reviewer, { contentItemId: itemId, decision: "APPROVED", feedback: null }),
      decideInternalReview(reviewer, { contentItemId: itemId, decision: "REJECTED", feedback: "No." }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.socialInternalReview.count({ where: { contentItemId: itemId, status: { in: ["APPROVED", "REJECTED"] } } })).toBe(1);
  });

  it("refuses to submit an empty idea", async () => {
    const item = await db.contentCalendarItem.create({
      data: { clientId: clientA, projectId: projectA, title: `${SUFFIX} empty`, channel: "LINKEDIN", stage: "DRAFT" },
      select: { id: true },
    });
    await expect(submitForInternalReview(writer, { contentItemId: item.id, note: null })).rejects.toBeInstanceOf(ValidationError);
    expect(await db.socialInternalReview.count({ where: { contentItemId: item.id } })).toBe(0);
  });

  it("withdraws a waiting round when a version is edited, so nobody approves it unseen", async () => {
    const { itemId, postId } = await makeItem("edit-while-waiting");
    await submitForInternalReview(writer, { contentItemId: itemId, note: null });
    await saveCaption(itemId, postId, "Rewritten while waiting.");

    const round = await db.socialInternalReview.findFirstOrThrow({ where: { contentItemId: itemId } });
    expect(round.status).toBe("WITHDRAWN");
    expect(await stageOf(itemId)).toBe("DRAFT");
    await expect(
      decideInternalReview(reviewer, { contentItemId: itemId, decision: "APPROVED", feedback: null }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("withdraws a waiting round when a version is deleted", async () => {
    const { itemId, postId } = await makeItem("delete-while-waiting");
    await submitForInternalReview(writer, { contentItemId: itemId, note: null });
    await deletePost(writer, postId);
    expect((await db.socialInternalReview.findFirstOrThrow({ where: { contentItemId: itemId } })).status).toBe("WITHDRAWN");
  });

  it("needs a new round after an edit, keeps every round, and says what each one contained", async () => {
    const { itemId, postId } = await makeItem("history");
    await approveInternally(itemId);
    await saveCaption(itemId, postId, "Changed after approval.");
    await expect(requestSocialApproval(writer, { contentItemId: itemId, note: null })).rejects.toThrow(/changed after it was approved/);

    await approveInternally(itemId);
    await expect(requestSocialApproval(writer, { contentItemId: itemId, note: null })).resolves.toBeDefined();

    const { rounds } = await internalReviewsFor(writer, itemId);
    expect(rounds.map((r) => [r.round, r.status])).toEqual([
      [2, "APPROVED"],
      [1, "APPROVED"],
    ]);
    expect(rounds[1]!.snapshot?.posts[0]?.caption).toBe("The history post.");
    expect(rounds[0]!.snapshot?.posts[0]?.caption).toBe("Changed after approval.");
  });

  it("keeps the internal approval when only the time moves", async () => {
    const { itemId, postId } = await makeItem("time-only");
    await approveInternally(itemId);
    await saveCaption(itemId, postId, "The time-only post.", future(9));
    expect((await internalReviewsFor(writer, itemId)).approvedAsItStands).toBe(true);
    await expect(requestSocialApproval(writer, { contentItemId: itemId, note: null })).resolves.toBeDefined();
  });

  it("keeps the client's approval when the editor only moves the time, and not when the words change", async () => {
    const a = await clientApproved("keeps");
    await saveCaption(a.itemId, a.postId, "The keeps post.", future(8));
    expect(await stageOf(a.itemId)).toBe("APPROVED");

    const b = await clientApproved("unsigns");
    await saveCaption(b.itemId, b.postId, "Different words now.");
    expect(await stageOf(b.itemId)).toBe("INTERNAL_REVIEW");
  });

  it("withdraws a submission on request and puts the idea back to draft", async () => {
    const { itemId } = await makeItem("pull-back");
    await submitForInternalReview(writer, { contentItemId: itemId, note: null });
    await withdrawInternalReview(writer, itemId);
    expect(await stageOf(itemId)).toBe("DRAFT");
    await expect(withdrawInternalReview(writer, itemId)).rejects.toBeInstanceOf(ConflictError);
  });

  it("never shows or accepts internal rounds from a portal user", async () => {
    const { itemId } = await makeItem("portal");
    await submitForInternalReview(writer, { contentItemId: itemId, note: null });
    const portalWithView = { ...portalA, permissions: new Set(["social.view", "social.edit", "social.review"]) };
    await expect(internalReviewsFor(portalWithView, itemId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(latestReviewStatuses(portalWithView, clientA)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      decideInternalReview(portalWithView, { contentItemId: itemId, decision: "APPROVED", feedback: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stops the general content board from moving social work to approved", async () => {
    const { itemId } = await makeItem("board");
    await approveInternally(itemId);
    const boardUser = staff(userId, ["content.view", "content.edit", "projects.view.team"]);
    await expect(setContentStage(boardUser, itemId, "APPROVED")).rejects.toThrow(/social content/);
    expect(await stageOf(itemId)).toBe("INTERNAL_REVIEW");
    // Nor can it then be scheduled.
    const post = await db.socialPost.findFirstOrThrow({ where: { contentItemId: itemId }, select: { id: true } });
    await expect(setPostStatus(writer, post.id, "SCHEDULED")).rejects.toBeInstanceOf(ForbiddenError);
  });

  // -------------------------------------------------------------------------
  // Reschedule
  // -------------------------------------------------------------------------

  it("reschedules a scheduled version without undoing any approval, and records both times", async () => {
    const { itemId, postId } = await clientApproved("move");
    await setPostStatus(writer, postId, "SCHEDULED");
    const before = (await db.socialPost.findUniqueOrThrow({ where: { id: postId } })).scheduledFor!;
    const to = future(12);
    await reschedulePost(writer, postId, to);

    const post = await db.socialPost.findUniqueOrThrow({ where: { id: postId } });
    expect(post.status).toBe("SCHEDULED");
    expect(post.scheduledFor?.toISOString()).toBe(to.toISOString());
    expect(await stageOf(itemId)).toBe("APPROVED");
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "SocialPost", entityId: postId, action: "UPDATE" }, orderBy: { createdAt: "desc" } });
    expect(audit.before).toEqual({ scheduledFor: before.toISOString() });
    expect(audit.after).toMatchObject({ scheduledFor: to.toISOString(), rescheduled: true });

    await expect(reschedulePost(writer, postId, new Date(Date.now() - 60_000))).rejects.toBeInstanceOf(ValidationError);
  });

  // -------------------------------------------------------------------------
  // Bulk
  // -------------------------------------------------------------------------

  it("approves in bulk, item by item, and calls another client's idea not found", async () => {
    const waiting = await makeItem("bulk-waiting");
    const idle = await makeItem("bulk-idle");
    const foreign = await makeItem("bulk-foreign", clientB, projectB);
    await submitForInternalReview(writer, { contentItemId: waiting.itemId, note: null });

    const results = await runBulkAction(reviewer, {
      clientId: clientA,
      itemIds: [waiting.itemId, idle.itemId, foreign.itemId],
      action: { kind: "approve", feedback: null },
    });
    const by = new Map(results.map((r) => [r.id, r]));
    expect(by.get(waiting.itemId)?.ok).toBe(true);
    expect(by.get(idle.itemId)).toMatchObject({ ok: false, message: expect.stringMatching(/Nothing is waiting/) });
    expect(by.get(foreign.itemId)).toMatchObject({ ok: false, label: "Unknown item", message: "Not found." });
    expect(await db.socialInternalReview.count({ where: { contentItemId: foreign.itemId } })).toBe(0);
  });

  it("refuses a bulk action the person may not take, before touching anything", async () => {
    const { itemId } = await makeItem("bulk-forbidden");
    await submitForInternalReview(writer, { contentItemId: itemId, note: null });
    await expect(
      runBulkAction(writer, { clientId: clientA, itemIds: [itemId], action: { kind: "approve", feedback: null } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      runBulkAction(writer, { clientId: clientA, itemIds: Array.from({ length: 101 }, (_, i) => `x${i}`), action: { kind: "schedule" } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("sends to the client in bulk only what internal review approved", async () => {
    const ready = await makeItem("bulk-ready");
    const notReady = await makeItem("bulk-not-ready");
    await approveInternally(ready.itemId);
    const results = await runBulkAction(writer, {
      clientId: clientA,
      itemIds: [ready.itemId, notReady.itemId],
      action: { kind: "requestClientReview", note: "October batch" },
    });
    expect(results.find((r) => r.id === ready.itemId)?.ok).toBe(true);
    expect(results.find((r) => r.id === notReady.itemId)?.ok).toBe(false);
    expect(await stageOf(ready.itemId)).toBe("CLIENT_REVIEW");
    expect(await stageOf(notReady.itemId)).toBe("DRAFT");
  });

  it("schedules in bulk only client-approved versions with a time still ahead", async () => {
    const approved = await clientApproved("bulk-sched");
    const late = await clientApproved("bulk-late");
    await db.socialPost.update({ where: { id: late.postId }, data: { scheduledFor: new Date(Date.now() - 3_600_000) } });
    const unapproved = await makeItem("bulk-unapproved");

    const results = await runBulkAction(writer, {
      clientId: clientA,
      itemIds: [approved.itemId, late.itemId, unapproved.itemId],
      action: { kind: "schedule" },
    });
    const by = new Map(results.map((r) => [r.id, r]));
    expect(by.get(approved.postId)?.ok).toBe(true);
    expect(by.get(late.postId)).toMatchObject({ ok: false, message: expect.stringMatching(/time has passed/) });
    expect(by.get(unapproved.postId)?.ok).toBe(false);
    const statuses = await db.socialPost.findMany({ where: { id: { in: [approved.postId, late.postId, unapproved.postId] } }, select: { id: true, status: true } });
    expect(Object.fromEntries(statuses.map((s) => [s.id, s.status]))).toEqual({
      [approved.postId]: "SCHEDULED",
      [late.postId]: "DRAFT",
      [unapproved.postId]: "DRAFT",
    });
  });

  it("reschedules in bulk by days, keeping the time of day, the approval and the idea's date in step", async () => {
    const a = await clientApproved("bulk-shift");
    await setPostStatus(writer, a.postId, "SCHEDULED");
    const [postBefore, itemBefore] = await Promise.all([
      db.socialPost.findUniqueOrThrow({ where: { id: a.postId } }),
      db.contentCalendarItem.findUniqueOrThrow({ where: { id: a.itemId } }),
    ]);

    const results = await runBulkAction(writer, { clientId: clientA, itemIds: [a.itemId], action: { kind: "reschedule", shiftDays: 3 } });
    expect(results.every((r) => r.ok)).toBe(true);

    const [postAfter, itemAfter] = await Promise.all([
      db.socialPost.findUniqueOrThrow({ where: { id: a.postId } }),
      db.contentCalendarItem.findUniqueOrThrow({ where: { id: a.itemId } }),
    ]);
    const threeDays = 3 * 86_400_000;
    expect(postAfter.scheduledFor!.getTime() - postBefore.scheduledFor!.getTime()).toBe(threeDays);
    expect(itemAfter.scheduledFor!.getTime() - itemBefore.scheduledFor!.getTime()).toBe(threeDays);
    expect(postAfter.status).toBe("SCHEDULED");
    expect(itemAfter.stage).toBe("APPROVED");
  });

  it("reschedules in bulk to a day, and never into the past or a published post", async () => {
    const a = await makeItem("bulk-to");
    const done = await makeItem("bulk-done");
    await db.socialPost.update({ where: { id: done.postId }, data: { status: "PUBLISHED" } });
    const target = future(20);
    const day = target.toISOString().slice(0, 10);
    const before = (await db.socialPost.findUniqueOrThrow({ where: { id: a.postId } })).scheduledFor!;

    const results = await runBulkAction(writer, {
      clientId: clientA,
      itemIds: [a.itemId, done.itemId],
      action: { kind: "reschedule", toDay: day },
    });
    expect(results.find((r) => r.id === a.postId)?.ok).toBe(true);
    expect(results.find((r) => r.id === done.postId)).toMatchObject({ ok: false, message: "Already gone out." });
    const after = (await db.socialPost.findUniqueOrThrow({ where: { id: a.postId } })).scheduledFor!;
    // Same time of day in the calendar's zone (IST has no DST), on the new day.
    expect((after.getTime() - before.getTime()) % 86_400_000).toBe(0);
    expect(after.toISOString().slice(0, 10)).toBe(day);

    const back = await runBulkAction(writer, { clientId: clientA, itemIds: [a.itemId], action: { kind: "reschedule", shiftDays: -90 } });
    expect(back[0]).toMatchObject({ ok: false, message: "That would put it in the past." });
  });

  it("assigns in bulk to active staff only", async () => {
    const a = await makeItem("bulk-assign");
    const ok = await runBulkAction(writer, { clientId: clientA, itemIds: [a.itemId], action: { kind: "assign", ownerId: otherUserId } });
    expect(ok[0]?.ok).toBe(true);
    expect((await db.contentCalendarItem.findUniqueOrThrow({ where: { id: a.itemId } })).ownerId).toBe(otherUserId);

    const portalUser = await db.user.findFirst({ where: { type: "CLIENT" }, select: { id: true } });
    if (portalUser) {
      const refused = await runBulkAction(writer, { clientId: clientA, itemIds: [a.itemId], action: { kind: "assign", ownerId: portalUser.id } });
      expect(refused[0]).toMatchObject({ ok: false, message: "That person is not active staff." });
    }
  });

  it("deletes drafts in bulk, and leaves anything the client has seen or that was scheduled", async () => {
    const draft = await makeItem("bulk-del-draft");
    const seen = await makeItem("bulk-del-seen");
    await approveInternally(seen.itemId);
    const { approvalId } = await requestSocialApproval(writer, { contentItemId: seen.itemId, note: null });
    await decideApproval(portalA, approvalId, "CHANGES_REQUESTED", "Not this one.");
    const tried = await makeItem("bulk-del-tried");
    await db.socialPost.update({ where: { id: tried.postId }, data: { attemptCount: 1 } });

    const results = await runBulkAction(writer, {
      clientId: clientA,
      itemIds: [draft.itemId, seen.itemId, tried.itemId],
      action: { kind: "deleteDrafts" },
    });
    const by = new Map(results.map((r) => [r.id, r]));
    expect(by.get(draft.itemId)?.ok).toBe(true);
    expect(by.get(seen.itemId)).toMatchObject({ ok: false, message: expect.stringMatching(/in front of the client/) });
    expect(by.get(tried.itemId)?.ok).toBe(false);
    const left = await db.contentCalendarItem.findMany({ where: { id: { in: [draft.itemId, seen.itemId, tried.itemId] } }, select: { id: true } });
    expect(left.map((l) => l.id).sort()).toEqual([seen.itemId, tried.itemId].sort());
    expect(await db.auditLog.count({ where: { entityType: "ContentCalendarItem", entityId: draft.itemId, action: "DELETE" } })).toBe(1);
  });
});
