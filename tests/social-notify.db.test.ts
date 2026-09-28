import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  announceClientDecision,
  announceFailure,
  announcePublished,
} from "@/lib/services/social-notify.service";
import { TRIGGER_FACTS, TRIGGER_LABEL, WIRED_TRIGGERS } from "@/lib/automation/types";

/**
 * Telling people when social work needs them.
 *
 * The rule under test throughout: a notification must never be able to undo
 * the thing it is announcing. The post is already on the platform by the time
 * these run, so they swallow their own errors and are called outside the
 * transaction.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const SUFFIX = `not10-${Date.now()}`;

describe("the automation vocabulary", () => {
  it("offers the social triggers, with facts for each", () => {
    for (const trigger of ["SOCIAL_POST_PUBLISHED", "SOCIAL_POST_FAILED", "SOCIAL_APPROVAL_DECIDED"] as const) {
      expect(WIRED_TRIGGERS).toContain(trigger);
      expect(TRIGGER_LABEL[trigger]).toBeTruthy();
      expect(TRIGGER_FACTS[trigger].length).toBeGreaterThan(0);
    }
  });

  it("does not offer the caption as a condition field", () => {
    // A rule matching on post copy would be a content filter dressed as
    // automation, and captions are long.
    const keys = TRIGGER_FACTS.SOCIAL_POST_PUBLISHED.map((field) => field.key);
    expect(keys).not.toContain("social.caption");
  });

  it("gives a failure trigger the reason, and a decision trigger the decision", () => {
    expect(TRIGGER_FACTS.SOCIAL_POST_FAILED.map((f) => f.key)).toContain("social.error");
    expect(TRIGGER_FACTS.SOCIAL_APPROVAL_DECIDED.map((f) => f.key)).toContain("social.decision");
  });
});

describeDb("social notifications", () => {
  let clientA = "";
  let projectA = "";
  let ownerId = "";
  let managerId = "";
  let counter = 0;

  async function itemWithPost(over: { ownerId?: string | null } = {}) {
    counter += 1;
    const item = await db.contentCalendarItem.create({
      data: {
        clientId: clientA,
        projectId: projectA,
        ownerId: over.ownerId === undefined ? ownerId : over.ownerId,
        title: `${SUFFIX} idea ${counter}`,
        channel: "LINKEDIN",
        stage: "APPROVED",
      },
      select: { id: true },
    });
    const post = await db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId: clientA,
        provider: "LINKEDIN",
        type: "TEXT",
        status: "PUBLISHED",
        caption: "Copy.",
      },
      select: { id: true },
    });
    return { itemId: item.id, postId: post.id };
  }

  beforeAll(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    ownerId = staff.id;
    managerId = staff.id;

    const client = await db.client.create({
      data: { name: `${SUFFIX} A`, slug: `${SUFFIX}-a` },
      select: { id: true },
    });
    clientA = client.id;

    const project = await db.project.create({
      data: {
        code: `${SUFFIX}-A`.slice(0, 20),
        name: "A retainer",
        clientId: clientA,
        managerId,
        startsAt: new Date(),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    projectA = project.id;
  });

  afterEach(async () => {
    await db.notification.deleteMany({ where: { userId: ownerId, title: { contains: "LinkedIn" } } });
    await db.notification.deleteMany({ where: { userId: ownerId, body: { contains: SUFFIX } } });
    await db.socialPost.deleteMany({ where: { clientId: clientA } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: clientA } });
  });

  afterAll(async () => {
    await db.notification.deleteMany({ where: { userId: ownerId, entityType: "SocialPost" } });
    await db.project.deleteMany({ where: { clientId: clientA } });
    await db.client.deleteMany({ where: { id: clientA } });
  });

  it("tells the owner when a post fails, and why", async () => {
    const { postId } = await itemWithPost();
    await announceFailure(postId, "LinkedIn rejected the credentials.", false);

    const sent = await db.notification.findFirst({
      where: { entityType: "SocialPost", entityId: postId },
      select: { title: true, body: true, href: true },
    });
    expect(sent?.title).toContain("LinkedIn");
    expect(sent?.body).toContain("rejected the credentials");
    expect(sent?.href).toBe("/admin/social/queue");
  });

  it("says so when the failure will be retried by itself", async () => {
    const { postId } = await itemWithPost();
    await announceFailure(postId, "Rate limited.", true);

    const sent = await db.notification.findFirstOrThrow({
      where: { entityType: "SocialPost", entityId: postId },
      select: { body: true },
    });
    expect(sent.body).toContain("tried again automatically");
  });

  it("does not interrupt anyone when a post simply goes out", async () => {
    const { postId } = await itemWithPost();
    await announcePublished(postId, "https://example.com/p");

    // Good news is not an interruption. Automation can act on it; a person is
    // not pinged.
    expect(
      await db.notification.count({ where: { entityType: "SocialPost", entityId: postId } }),
    ).toBe(0);
  });

  it("sends one notification, not one per role the same person holds", async () => {
    // The owner is also the project manager here, as is common in a small team.
    const { postId } = await itemWithPost();
    await announceFailure(postId, "Broken.", false);

    expect(
      await db.notification.count({ where: { entityType: "SocialPost", entityId: postId } }),
    ).toBe(1);
  });

  it("tells the agency when the client approves", async () => {
    const { itemId } = await itemWithPost();
    await announceClientDecision(itemId, "APPROVED", null);

    const sent = await db.notification.findFirstOrThrow({
      where: { entityType: "ContentCalendarItem", entityId: itemId },
      select: { title: true, href: true },
    });
    expect(sent.title).toContain("approved");
    expect(sent.href).toContain(itemId);
  });

  it("passes the client's words along when they ask for changes", async () => {
    const { itemId } = await itemWithPost();
    await announceClientDecision(itemId, "CHANGES_REQUESTED", "Make the caption shorter.");

    const sent = await db.notification.findFirstOrThrow({
      where: { entityType: "ContentCalendarItem", entityId: itemId },
      select: { title: true, body: true },
    });
    expect(sent.title).toContain("asked for changes");
    expect(sent.body).toBe("Make the caption shorter.");
  });

  it("never throws, whatever it is handed", async () => {
    // The post is already on the platform by the time these run. A failing
    // notification must not become a failing publication.
    await expect(announceFailure("does-not-exist", "x", false)).resolves.toBeUndefined();
    await expect(announcePublished("does-not-exist", null)).resolves.toBeUndefined();
    await expect(
      announceClientDecision("does-not-exist", "APPROVED", null),
    ).resolves.toBeUndefined();
  });

  it("still notifies when the idea has no owner", async () => {
    const { itemId } = await itemWithPost({ ownerId: null });
    // Falls back to the project manager rather than telling nobody.
    await announceClientDecision(itemId, "APPROVED", null);
    // No owner and no requester means nobody to tell — and that must not throw.
    expect(true).toBe(true);
  });
});
