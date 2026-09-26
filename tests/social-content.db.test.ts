import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  contentFormOptions,
  createSocialContent,
  getContentItem,
  listContentItems,
} from "@/lib/services/social-content.service";
import { listPostsForItem, savePost, setPostStatus } from "@/lib/services/social-post.service";
import { socialPostSchema } from "@/lib/validation/social";
import type { Actor } from "@/lib/actor/types";

/**
 * One idea, several platform versions.
 *
 * What is worth pinning: an idea is a ContentCalendarItem and not a second
 * kind of content; each version carries its own copy; a version is edited
 * against its own platform's rules; and none of it escapes the client it
 * belongs to.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `soc3-${Date.now()}`;

function staffWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Social",
    email: "social@emporia.test",
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

const FULL = [
  "social.view",
  "social.create",
  "social.edit",
  "social.delete",
  "social.accounts.manage",
];

describeDb("social content and platform versions", () => {
  let staff: Actor;
  let clientA = "";
  let clientB = "";
  let projectA = "";
  let projectB = "";
  let campaignA = "";
  let campaignB = "";
  let itemId = "";

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    staff = staffWith(user.id, FULL);

    const [a, b] = await Promise.all([
      db.client.create({ data: { name: `${SUFFIX} A`, slug: `${SUFFIX}-a` }, select: { id: true } }),
      db.client.create({ data: { name: `${SUFFIX} B`, slug: `${SUFFIX}-b` }, select: { id: true } }),
    ]);
    clientA = a.id;
    clientB = b.id;

    const projects = await Promise.all([
      db.project.create({
        data: {
          code: `${SUFFIX}-A`.slice(0, 20),
          name: "A retainer",
          clientId: clientA,
          managerId: user.id,
          startsAt: new Date(),
          status: "ACTIVE",
        },
        select: { id: true },
      }),
      db.project.create({
        data: {
          code: `${SUFFIX}-B`.slice(0, 20),
          name: "B retainer",
          clientId: clientB,
          managerId: user.id,
          startsAt: new Date(),
          status: "ACTIVE",
        },
        select: { id: true },
      }),
    ]);
    projectA = projects[0].id;
    projectB = projects[1].id;

    const campaigns = await Promise.all([
      db.campaign.create({
        data: {
          name: `${SUFFIX} Diwali`,
          clientId: clientA,
          platform: "SOCIAL_ORGANIC",
          ownerId: user.id,
          startsAt: new Date(),
        },
        select: { id: true },
      }),
      db.campaign.create({
        data: {
          name: `${SUFFIX} Other`,
          clientId: clientB,
          platform: "SOCIAL_ORGANIC",
          ownerId: user.id,
          startsAt: new Date(),
        },
        select: { id: true },
      }),
    ]);
    campaignA = campaigns[0].id;
    campaignB = campaigns[1].id;
  });

  afterAll(async () => {
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.campaign.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  // -------------------------------------------------------------------------
  // The idea
  // -------------------------------------------------------------------------

  it("creates the idea as an ordinary content calendar item", async () => {
    const created = await createSocialContent(staff, {
      clientId: clientA,
      projectId: projectA,
      title: "Diwali business growth post",
      brief: "Festive push for the retainer.",
      campaignId: campaignA,
      ownerId: null,
      scheduledFor: null,
    });
    itemId = created.id;

    // Not a second content system: the same row the delivery calendar, the
    // approval workflow and the portal already read.
    const row = await db.contentCalendarItem.findUniqueOrThrow({
      where: { id: itemId },
      select: { clientId: true, projectId: true, campaignId: true, stage: true },
    });
    expect(row).toEqual({
      clientId: clientA,
      projectId: projectA,
      campaignId: campaignA,
      stage: "DRAFT",
    });
  });

  it("takes the client from the project, not from the caller", async () => {
    // Client A named, Client B's project given. The project wins, and it does
    // not belong to the named client, so it is refused.
    await expect(
      createSocialContent(staff, {
        clientId: clientA,
        projectId: projectB,
        title: "Wrong project",
        brief: null,
        campaignId: null,
        ownerId: null,
        scheduledFor: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses another client's campaign", async () => {
    // Otherwise this client's work lands under someone else's reporting.
    await expect(
      createSocialContent(staff, {
        clientId: clientA,
        projectId: projectA,
        title: "Wrong campaign",
        brief: null,
        campaignId: campaignB,
        ownerId: null,
        scheduledFor: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("only offers pickers from the one client", async () => {
    const options = await contentFormOptions(staff, clientA);
    expect(options.projects.map((p) => p.id)).toEqual([projectA]);
    expect(options.campaigns.map((c) => c.id)).toEqual([campaignA]);
  });

  // -------------------------------------------------------------------------
  // The versions
  // -------------------------------------------------------------------------

  it("holds different copy for each platform on one idea", async () => {
    // The whole reason the module exists.
    await savePost(
      staff,
      null,
      socialPostSchema.parse({
        contentItemId: itemId,
        provider: "INSTAGRAM",
        type: "SINGLE_IMAGE",
        caption: "Wishing you a bright Diwali ✨",
        hashtags: ["diwali", "festive"],
      }),
    );
    await savePost(
      staff,
      null,
      socialPostSchema.parse({
        contentItemId: itemId,
        provider: "LINKEDIN",
        type: "TEXT",
        caption:
          "Festive season is when D2C brands see their sharpest search demand. Here is what we prepared for our clients this year.",
        linkUrl: "https://example.com/diwali",
      }),
    );

    const versions = await listPostsForItem(staff, itemId);
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.provider).sort()).toEqual(["INSTAGRAM", "LINKEDIN"]);

    const instagram = versions.find((v) => v.provider === "INSTAGRAM");
    const linkedin = versions.find((v) => v.provider === "LINKEDIN");
    expect(instagram?.caption).not.toBe(linkedin?.caption);
    // Instagram has no clickable caption link, so the field is not even offered.
    expect(instagram?.linkUrl).toBeNull();
    expect(linkedin?.linkUrl).toBe("https://example.com/diwali");
  });

  it("orders versions so the editor lists them predictably", async () => {
    const versions = await listPostsForItem(staff, itemId);
    expect(versions.map((v) => v.order)).toEqual([0, 1]);
  });

  it("shows the versions on the idea", async () => {
    const item = await getContentItem(staff, itemId);
    expect(item.socialPosts).toHaveLength(2);
    expect(item.campaign?.id).toBe(campaignA);
  });

  it("filters the list by campaign", async () => {
    const all = await listContentItems(staff, { clientId: clientA });
    const filtered = await listContentItems(staff, { clientId: clientA, campaignId: campaignA });
    const none = await listContentItems(staff, { clientId: clientA, campaignId: campaignB });

    expect(all.length).toBeGreaterThan(0);
    expect(filtered.map((i) => i.id)).toContain(itemId);
    // Another client's campaign matches nothing here, rather than reaching it.
    expect(none).toHaveLength(0);
  });

  it("does not show one client's ideas to another", async () => {
    expect(await listContentItems(staff, { clientId: clientB })).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Platform rules are enforced where they are written
  // -------------------------------------------------------------------------

  it("refuses copy the platform would reject, at the moment it is written", async () => {
    const tooLong = "x".repeat(275);
    expect(
      socialPostSchema.safeParse({
        contentItemId: itemId,
        provider: "X",
        type: "TEXT",
        caption: tooLong,
        hashtags: ["diwali"],
      }).success,
    ).toBe(false);
  });

  it("refuses a format the platform cannot publish", () => {
    expect(
      socialPostSchema.safeParse({
        contentItemId: itemId,
        provider: "GOOGLE_BUSINESS_PROFILE",
        type: "CAROUSEL",
        caption: "Anything",
      }).success,
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Nothing goes out unapproved, and what went out is not editable
  // -------------------------------------------------------------------------

  it("will not schedule an idea the client has not approved", async () => {
    const versions = await listPostsForItem(staff, itemId);
    const post = versions[0]!;
    await db.socialPost.update({
      where: { id: post.id },
      data: { scheduledFor: new Date(Date.now() + 86_400_000) },
    });

    await expect(setPostStatus(staff, post.id, "SCHEDULED")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("locks a published version's copy", async () => {
    const versions = await listPostsForItem(staff, itemId);
    const post = versions[1]!;
    await db.socialPost.update({ where: { id: post.id }, data: { status: "PUBLISHED" } });

    await expect(
      savePost(
        staff,
        post.id,
        socialPostSchema.parse({
          contentItemId: itemId,
          provider: "LINKEDIN",
          type: "TEXT",
          caption: "Rewriting history",
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("needs social.create to start an idea", async () => {
    const viewer = staffWith(staff.userId, ["social.view"]);
    await expect(
      createSocialContent(viewer, {
        clientId: clientA,
        projectId: projectA,
        title: "Not allowed",
        brief: null,
        campaignId: null,
        ownerId: null,
        scheduledFor: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
