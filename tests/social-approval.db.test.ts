import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  requestSocialApproval,
  socialApprovalFor,
  withdrawSocialApproval,
} from "@/lib/services/social-approval.service";
import { savePost } from "@/lib/services/social-post.service";
import { decideApproval, getApproval } from "@/lib/services/portal.service";
import { socialPostSchema } from "@/lib/validation/social";
import type { Actor, PortalActor } from "@/lib/actor/types";

/**
 * Client sign-off on social content.
 *
 * The rules worth pinning are the ones that make "approved" mean something:
 * what the client saw is frozen, the copy cannot move while they are reading
 * it, and their decision moves the content stage rather than leaving the
 * approval and the calendar disagreeing.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `appr5-${Date.now()}`;

const FULL = [
  "social.view",
  "social.create",
  "social.edit",
  "social.delete",
  "social.approve",
];

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

describeDb("social client approval", () => {
  let staff: Actor;
  let clientA = "";
  let clientB = "";
  let projectA = "";
  let userId = "";
  let portalA: PortalActor;
  let portalB: PortalActor;

  /** A fresh idea with one written Instagram version, ready to send. */
  async function makeItem(title: string, stage: "DRAFT" | "INTERNAL_REVIEW" = "INTERNAL_REVIEW") {
    const item = await db.contentCalendarItem.create({
      data: {
        clientId: clientA,
        projectId: projectA,
        ownerId: userId,
        title: `${SUFFIX} ${title}`,
        channel: "LINKEDIN",
        stage,
        scheduledFor: new Date("2026-10-05T14:00:00Z"),
      },
      select: { id: true },
    });

    await savePost(
      staff,
      null,
      socialPostSchema.parse({
        contentItemId: item.id,
        provider: "LINKEDIN",
        type: "TEXT",
        caption: "First draft of the festive post.",
      }),
    );

    return item.id;
  }

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = user.id;
    staff = staffWith(user.id, FULL);

    const [a, b] = await Promise.all([
      db.client.create({ data: { name: `${SUFFIX} A`, slug: `${SUFFIX}-a` }, select: { id: true } }),
      db.client.create({ data: { name: `${SUFFIX} B`, slug: `${SUFFIX}-b` }, select: { id: true } }),
    ]);
    clientA = a.id;
    clientB = b.id;

    const portalActor = (name: string, clientId: string): PortalActor => ({
      userId: user.id,
      type: "CLIENT" as const,
      name,
      email: `${name.toLowerCase().replace(/\s+/g, "-")}@example.com`,
      roleName: "CLIENT_USER",
      roleId: null,
      clientId,
      permissions: new Set<string>(),
      ip: null,
      userAgent: "vitest",
    });
    portalA = portalActor("Client A", clientA);
    portalB = portalActor("Client B", clientB);

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
  });

  afterAll(async () => {
    await db.approval.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  it("sends the item to the client and moves it to client review", async () => {
    const itemId = await makeItem("send");
    const { approvalId, version } = await requestSocialApproval(staff, {
      contentItemId: itemId,
      note: "First round.",
    });

    expect(version).toBe(1);
    const item = await db.contentCalendarItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { stage: true },
    });
    expect(item.stage).toBe("CLIENT_REVIEW");

    const approval = await db.approval.findUniqueOrThrow({
      where: { id: approvalId },
      select: { status: true, contentItemId: true, clientId: true },
    });
    expect(approval.status).toBe("PENDING");
    expect(approval.contentItemId).toBe(itemId);
    expect(approval.clientId).toBe(clientA);
  });

  it("freezes the copy that was sent, so a later edit cannot rewrite history", async () => {
    const itemId = await makeItem("freeze");
    await requestSocialApproval(staff, { contentItemId: itemId, note: null });

    const sent = await socialApprovalFor(staff, itemId);
    expect(sent!.versions[0]!.snapshot!.posts[0]!.caption).toBe(
      "First draft of the festive post.",
    );

    // Pull it back, rewrite the caption, and the snapshot must not follow.
    await withdrawSocialApproval(staff, itemId);
    const post = await db.socialPost.findFirstOrThrow({
      where: { contentItemId: itemId },
      select: { id: true },
    });
    await savePost(
      staff,
      post.id,
      socialPostSchema.parse({
        contentItemId: itemId,
        provider: "LINKEDIN",
        type: "TEXT",
        caption: "Completely different copy.",
      }),
    );

    const after = await socialApprovalFor(staff, itemId);
    expect(after!.versions[0]!.snapshot!.posts[0]!.caption).toBe(
      "First draft of the festive post.",
    );
  });

  it("refuses to send an idea with no versions written", async () => {
    const empty = await db.contentCalendarItem.create({
      data: {
        clientId: clientA,
        projectId: projectA,
        title: `${SUFFIX} empty`,
        channel: "LINKEDIN",
        stage: "INTERNAL_REVIEW",
      },
      select: { id: true },
    });

    await expect(
      requestSocialApproval(staff, { contentItemId: empty.id, note: null }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to send the same item twice while it is still out", async () => {
    const itemId = await makeItem("twice");
    await requestSocialApproval(staff, { contentItemId: itemId, note: null });

    await expect(
      requestSocialApproval(staff, { contentItemId: itemId, note: null }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses an actor without social.approve", async () => {
    const itemId = await makeItem("perms");
    const viewer = staffWith(userId, ["social.view", "social.edit"]);

    await expect(
      requestSocialApproval(viewer, { contentItemId: itemId, note: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // -------------------------------------------------------------------------
  // The lock
  // -------------------------------------------------------------------------

  it("refuses to edit a version while the client is reading it", async () => {
    const itemId = await makeItem("locked");
    const post = await db.socialPost.findFirstOrThrow({
      where: { contentItemId: itemId },
      select: { id: true },
    });
    await requestSocialApproval(staff, { contentItemId: itemId, note: null });

    await expect(
      savePost(
        staff,
        post.id,
        socialPostSchema.parse({
          contentItemId: itemId,
          provider: "LINKEDIN",
          type: "TEXT",
          caption: "Sneaking a change in.",
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows editing again once the work is withdrawn", async () => {
    const itemId = await makeItem("withdraw-edit");
    const post = await db.socialPost.findFirstOrThrow({
      where: { contentItemId: itemId },
      select: { id: true },
    });
    await requestSocialApproval(staff, { contentItemId: itemId, note: null });
    await withdrawSocialApproval(staff, itemId);

    const saved = await savePost(
      staff,
      post.id,
      socialPostSchema.parse({
        contentItemId: itemId,
        provider: "LINKEDIN",
        type: "TEXT",
        caption: "Fixed the typo.",
      }),
    );
    expect(saved.caption).toBe("Fixed the typo.");
  });

  it("marks a withdrawn approval withdrawn, not pending or rejected", async () => {
    const itemId = await makeItem("withdraw-state");
    const { approvalId } = await requestSocialApproval(staff, {
      contentItemId: itemId,
      note: null,
    });
    await withdrawSocialApproval(staff, itemId);

    const approval = await db.approval.findUniqueOrThrow({
      where: { id: approvalId },
      select: { status: true, contentItem: { select: { stage: true } } },
    });
    expect(approval.status).toBe("WITHDRAWN");
    expect(approval.contentItem!.stage).toBe("INTERNAL_REVIEW");
  });

  it("refuses to withdraw when nothing is with the client", async () => {
    const itemId = await makeItem("nothing-out");
    await expect(withdrawSocialApproval(staff, itemId)).rejects.toBeInstanceOf(ConflictError);
  });

  // -------------------------------------------------------------------------
  // The client's decision
  // -------------------------------------------------------------------------

  it("moves the content to approved when the client approves", async () => {
    const itemId = await makeItem("approve");
    const { approvalId } = await requestSocialApproval(staff, {
      contentItemId: itemId,
      note: null,
    });

    await decideApproval(portalA, approvalId, "APPROVED", null);

    const item = await db.contentCalendarItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { stage: true },
    });
    expect(item.stage).toBe("APPROVED");
  });

  it("sends the content back to draft when the client asks for changes", async () => {
    const itemId = await makeItem("changes");
    const { approvalId } = await requestSocialApproval(staff, {
      contentItemId: itemId,
      note: null,
    });

    await decideApproval(portalA, approvalId, "CHANGES_REQUESTED", "Make the caption shorter.");

    const item = await db.contentCalendarItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { stage: true },
    });
    expect(item.stage).toBe("DRAFT");
  });

  it("opens a second round on the same thread rather than a new approval", async () => {
    const itemId = await makeItem("round-two");
    const first = await requestSocialApproval(staff, { contentItemId: itemId, note: null });
    await decideApproval(portalA, first.approvalId, "CHANGES_REQUESTED", "Shorter, please.");

    const post = await db.socialPost.findFirstOrThrow({
      where: { contentItemId: itemId },
      select: { id: true },
    });
    await savePost(
      staff,
      post.id,
      socialPostSchema.parse({
        contentItemId: itemId,
        provider: "LINKEDIN",
        type: "TEXT",
        caption: "Shorter copy.",
      }),
    );
    // Back up to internal review before it can go out again.
    await db.contentCalendarItem.update({
      where: { id: itemId },
      data: { stage: "INTERNAL_REVIEW" },
    });

    const second = await requestSocialApproval(staff, { contentItemId: itemId, note: null });
    expect(second.approvalId).toBe(first.approvalId);
    expect(second.version).toBe(2);

    const approvals = await db.approval.count({ where: { contentItemId: itemId } });
    expect(approvals).toBe(1);

    // Each round keeps its own copy of what was sent.
    const thread = await socialApprovalFor(staff, itemId);
    expect(thread!.versions.map((v) => v.snapshot!.posts[0]!.caption)).toEqual([
      "Shorter copy.",
      "First draft of the festive post.",
    ]);
  });

  it("refuses a second decision on a version already decided", async () => {
    const itemId = await makeItem("double-decide");
    const { approvalId } = await requestSocialApproval(staff, {
      contentItemId: itemId,
      note: null,
    });
    await decideApproval(portalA, approvalId, "APPROVED", null);

    await expect(
      decideApproval(portalA, approvalId, "CHANGES_REQUESTED", "Actually, no."),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("requires a reason when the client asks for changes", async () => {
    const itemId = await makeItem("reason");
    const { approvalId } = await requestSocialApproval(staff, {
      contentItemId: itemId,
      note: null,
    });

    await expect(
      decideApproval(portalA, approvalId, "CHANGES_REQUESTED", null),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("un-approves the item when the copy is edited after sign-off", async () => {
    const itemId = await makeItem("edit-after-approval");
    const { approvalId } = await requestSocialApproval(staff, {
      contentItemId: itemId,
      note: null,
    });
    await decideApproval(portalA, approvalId, "APPROVED", null);

    const post = await db.socialPost.findFirstOrThrow({
      where: { contentItemId: itemId },
      select: { id: true },
    });
    await savePost(
      staff,
      post.id,
      socialPostSchema.parse({
        contentItemId: itemId,
        provider: "LINKEDIN",
        type: "TEXT",
        caption: "Words nobody agreed to.",
      }),
    );

    const item = await db.contentCalendarItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { stage: true },
    });
    expect(item.stage).toBe("INTERNAL_REVIEW");

    // The approval keeps its own history — it was approved, and that happened.
    const approval = await db.approval.findUniqueOrThrow({
      where: { id: approvalId },
      select: { status: true },
    });
    expect(approval.status).toBe("APPROVED");
  });

  // -------------------------------------------------------------------------
  // Isolation
  // -------------------------------------------------------------------------

  it("hides another client's approval from the portal entirely", async () => {
    const itemId = await makeItem("isolation");
    const { approvalId } = await requestSocialApproval(staff, {
      contentItemId: itemId,
      note: null,
    });

    await expect(getApproval(portalB, approvalId)).rejects.toThrow();
    await expect(decideApproval(portalB, approvalId, "APPROVED", null)).rejects.toThrow();

    // And the decision the other client tried to make did not land.
    const approval = await db.approval.findUniqueOrThrow({
      where: { id: approvalId },
      select: { status: true },
    });
    expect(approval.status).toBe("PENDING");
  });

  it("gives the portal the frozen copy, with no account or token fields on it", async () => {
    const itemId = await makeItem("portal-read");
    const { approvalId } = await requestSocialApproval(staff, {
      contentItemId: itemId,
      note: "Have a look.",
    });

    const seen = await getApproval(portalA, approvalId);
    const snapshot = seen.versions[0]!.snapshot;

    expect(snapshot).not.toBeNull();
    expect(snapshot!.posts[0]!.caption).toBe("First draft of the festive post.");

    const serialised = JSON.stringify(snapshot);
    for (const forbidden of ["accessToken", "refreshToken", "token", "accountId", "clientId"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});
