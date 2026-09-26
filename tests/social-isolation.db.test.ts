import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import {
  accountHealth,
  connectAccount,
  credentialsFor,
  disconnectAccount,
  getAccount,
  listAccounts,
  recordSyncResult,
} from "@/lib/services/social-account.service";
import { getPost, listPosts, savePost, setPostStatus } from "@/lib/services/social-post.service";
import { socialPostSchema } from "@/lib/validation/social";
import type { Actor } from "@/lib/actor/types";

/**
 * Client isolation and credential safety.
 *
 * These are the two properties the social module cannot be shipped without.
 * Everything else is a feature; these are the reasons an agency can put three
 * competitors' Instagram accounts in one system.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `soc-${Date.now()}`;

function staffWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Social manager",
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

function portalUserFor(userId: string, clientId: string): Actor {
  return {
    userId,
    name: "Client",
    email: "client@emporia.test",
    type: "CLIENT",
    roleName: "CLIENT_USER",
    roleId: null,
    clientId,
    permissions: new Set(["social.view"]),
    ip: null,
    userAgent: "vitest",
  };
}

const FULL = [
  "social.view",
  "social.create",
  "social.edit",
  "social.delete",
  "social.approve",
  "social.publish",
  "social.accounts.manage",
];

describeDb("social module — isolation and credentials", () => {
  let staff: Actor;
  let clientA = "";
  let clientB = "";
  let itemA = "";
  let accountA = "";
  let projectA = "";

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    staff = staffWith(user.id, FULL);

    const [a, b] = await Promise.all([
      db.client.create({ data: { name: `${SUFFIX} A`, slug: `${SUFFIX}-a` }, select: { id: true } }),
      db.client.create({ data: { name: `${SUFFIX} B`, slug: `${SUFFIX}-b` }, select: { id: true } }),
    ]);
    clientA = a.id;
    clientB = b.id;

    const project = await db.project.create({
      data: {
        code: `${SUFFIX}-P1`.slice(0, 20),
        name: "Social retainer",
        clientId: clientA,
        managerId: user.id,
        startsAt: new Date(),
      },
      select: { id: true },
    });
    projectA = project.id;

    const item = await db.contentCalendarItem.create({
      data: {
        projectId: projectA,
        clientId: clientA,
        channel: "INSTAGRAM",
        title: "Diwali launch",
        stage: "DRAFT",
      },
      select: { id: true },
    });
    itemA = item.id;

    const account = await connectAccount(staff, {
      clientId: clientA,
      provider: "INSTAGRAM",
      account: {
        externalId: `${SUFFIX}-ig`,
        name: "Client A Instagram",
        username: "client_a",
        profileUrl: "https://example.com/client_a",
        avatarUrl: null,
        scopes: ["instagram_content_publish"],
      },
      credentials: { accessToken: "super-secret-token", refreshToken: "refresh-me", expiresAt: null },
    });
    accountA = account.id;
  });

  afterAll(async () => {
    // Projects restrict client deletion on purpose — a client with delivery
    // behind them is not something you remove by accident — so the fixture
    // unwinds in the same order a real deletion would have to.
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  // -------------------------------------------------------------------------
  // Credentials never leave the service
  // -------------------------------------------------------------------------

  it("never returns a token from any read", async () => {
    const [list, one] = await Promise.all([listAccounts(staff, clientA), getAccount(staff, accountA)]);
    const payload = JSON.stringify({ list, one });

    // The whole point. Not masked, not truncated — absent.
    expect(payload).not.toContain("super-secret-token");
    expect(payload).not.toContain("refresh-me");
    expect(payload).not.toMatch(/accessToken|refreshToken/);
  });

  it("stores the token encrypted, not in plain text", async () => {
    const row = await db.socialAccount.findUniqueOrThrow({
      where: { id: accountA },
      select: { accessToken: true },
    });
    expect(row.accessToken).not.toBeNull();
    expect(row.accessToken).not.toContain("super-secret-token");
  });

  it("hands the real token only to the adapter path", async () => {
    const credentials = await credentialsFor(accountA);
    expect(credentials?.accessToken).toBe("super-secret-token");
    expect(credentials?.refreshToken).toBe("refresh-me");
  });

  it("keeps no token in the audit trail", async () => {
    const entries = await db.auditLog.findMany({
      where: { entityType: "SocialAccount" },
      select: { before: true, after: true },
    });
    expect(JSON.stringify(entries)).not.toContain("super-secret-token");
  });

  // -------------------------------------------------------------------------
  // Client isolation
  // -------------------------------------------------------------------------

  it("does not leak another client's accounts into a list", async () => {
    const rows = await listAccounts(staff, clientB);
    expect(rows).toHaveLength(0);
  });

  it("refuses a portal user asking for another client", async () => {
    const portal = portalUserFor(staff.userId, clientB);
    await expect(listAccounts(portal, clientA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getAccount(portal, accountA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("ignores the clientId a portal user supplies and uses the session's", async () => {
    // The browser can ask for anything; the answer comes from the session.
    const portal = portalUserFor(staff.userId, clientA);
    const rows = await listAccounts(portal, null);
    expect(rows.every((row) => row.clientId === clientA)).toBe(true);
  });

  it("refuses connecting one platform account to two clients", async () => {
    await expect(
      connectAccount(staff, {
        clientId: clientB,
        provider: "INSTAGRAM",
        account: {
          externalId: `${SUFFIX}-ig`,
          name: "Same account, other client",
          username: null,
          profileUrl: null,
          avatarUrl: null,
          scopes: [],
        },
        credentials: { accessToken: "another", refreshToken: null, expiresAt: null },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("needs social.accounts.manage to connect or disconnect", async () => {
    const editor = staffWith(staff.userId, ["social.view", "social.edit"]);
    await expect(disconnectAccount(editor, accountA)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // -------------------------------------------------------------------------
  // Posts carry their client from the content item
  // -------------------------------------------------------------------------

  it("copies clientId from the content item rather than taking it from the caller", async () => {
    const input = socialPostSchema.parse({
      contentItemId: itemA,
      provider: "INSTAGRAM",
      type: "SINGLE_IMAGE",
      caption: "Wishing you a bright Diwali.",
      hashtags: ["#diwali", "festive"],
    });
    const post = await savePost(staff, null, input);

    expect(post.clientId).toBe(clientA);
    // Normalised on the way in, so "#diwali" and "diwali" are one tag.
    expect(post.hashtags).toEqual(["diwali", "festive"]);
  });

  it("refuses a post on another client's account", async () => {
    const otherProject = await db.project.create({
      data: {
        code: `${SUFFIX}-P2`.slice(0, 20),
        name: "B retainer",
        clientId: clientB,
        managerId: staff.userId,
        startsAt: new Date(),
      },
      select: { id: true },
    });
    const itemB = await db.contentCalendarItem.create({
      data: {
        projectId: otherProject.id,
        clientId: clientB,
        channel: "INSTAGRAM",
        title: "B post",
        stage: "DRAFT",
      },
      select: { id: true },
    });

    // Client B's content pointed at Client A's Instagram account.
    await expect(
      savePost(
        staff,
        null,
        socialPostSchema.parse({
          contentItemId: itemB.id,
          accountId: accountA,
          provider: "INSTAGRAM",
          type: "SINGLE_IMAGE",
          caption: "Not allowed.",
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not show one client's posts to another", async () => {
    const forB = await listPosts(staff, {
      clientId: clientB,
      provider: null,
      status: null,
      campaignId: null,
      from: null,
      to: null,
    });
    expect(forB).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Nothing goes out unapproved
  // -------------------------------------------------------------------------

  it("refuses to schedule content the client has not approved", async () => {
    const post = await savePost(
      staff,
      null,
      socialPostSchema.parse({
        contentItemId: itemA,
        accountId: accountA,
        provider: "INSTAGRAM",
        type: "SINGLE_IMAGE",
        caption: "Ready to go.",
        scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );

    // The content item is still DRAFT.
    await expect(setPostStatus(staff, post.id, "SCHEDULED")).rejects.toBeInstanceOf(ForbiddenError);

    await db.contentCalendarItem.update({ where: { id: itemA }, data: { stage: "APPROVED" } });
    const scheduled = await setPostStatus(staff, post.id, "SCHEDULED");
    expect(scheduled.status).toBe("SCHEDULED");
  });

  it("does not let a screen mark a post published", async () => {
    const post = await getPost(
      staff,
      (
        await listPosts(staff, {
          clientId: clientA,
          provider: null,
          status: "SCHEDULED",
          campaignId: null,
          from: null,
          to: null,
        })
      )[0]!.id,
    );
    // Only the publishing engine may claim a row into PUBLISHING/PUBLISHED.
    await expect(setPostStatus(staff, post.id, "PUBLISHED")).rejects.toBeInstanceOf(ConflictError);
    await expect(setPostStatus(staff, post.id, "PUBLISHING")).rejects.toBeInstanceOf(ConflictError);
  });

  // -------------------------------------------------------------------------
  // Account health
  // -------------------------------------------------------------------------

  it("does not mark an account broken on one bad minute", async () => {
    await recordSyncResult(accountA, { ok: false, error: "Timed out." });
    const after = await getAccount(staff, accountA);
    expect(after.status).toBe("CONNECTED");
    expect(accountHealth(after)).toBe("ATTENTION");
  });

  it("asks for a reconnect when the provider rejects the credentials", async () => {
    await recordSyncResult(accountA, {
      ok: false,
      error: "The token has expired.",
      credentialsRejected: true,
    });
    const after = await getAccount(staff, accountA);
    expect(after.status).toBe("NEEDS_RECONNECT");
    expect(accountHealth(after)).toBe("ATTENTION");
  });

  it("clears the failure state on a good sync", async () => {
    await recordSyncResult(accountA, { ok: true });
    const after = await getAccount(staff, accountA);
    expect(after).toMatchObject({ status: "CONNECTED", failureCount: 0, lastSyncError: null });
    expect(accountHealth(after)).toBe("HEALTHY");
  });

  it("keeps the row and the history when an account is disconnected", async () => {
    const before = await db.socialPost.count({ where: { clientId: clientA } });
    const account = await disconnectAccount(staff, accountA);

    expect(account.status).toBe("DISCONNECTED");
    expect(await credentialsFor(accountA)).toBeNull();
    // The posts that went out through it are still the client's record.
    expect(await db.socialPost.count({ where: { clientId: clientA } })).toBe(before);
  });
});
