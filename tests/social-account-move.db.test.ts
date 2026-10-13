import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  connectAccount,
  credentialsFor,
  moveAccount,
  moveTargets,
} from "@/lib/services/social-account.service";
import { getPendingConnection, startPendingConnection } from "@/lib/services/social-pending.service";
import { portalSocialAccounts } from "@/lib/services/portal-social.service";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import type { Actor, PortalActor } from "@/lib/actor/types";
import type { ProviderAccount, ProviderCredentials } from "@/lib/social/types";

/**
 * Moving an account between clients, and clients connecting their own
 * accounts from the portal.
 *
 * Both touch the same property the social module is built around — whose
 * account is this — so both are tested for what they must not do as much as
 * for what they do: a move carries nothing of the old client's across, and a
 * portal user reaches their own client and nothing else.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const TAG = `mv-${Date.now()}`;

function staff(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Staff",
    email: "staff@emporia.test",
    type: "STAFF",
    roleName: "ADMIN",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

function portalUser(userId: string, clientId: string): PortalActor {
  return {
    userId,
    name: "Client",
    email: "client@emporia.test",
    type: "CLIENT",
    roleName: "CLIENT_USER",
    roleId: null,
    clientId,
    permissions: new Set(),
    ip: null,
    userAgent: "vitest",
  };
}

const account = (externalId: string, name = "Northwind LinkedIn"): ProviderAccount => ({
  externalId,
  name,
  username: "northwind",
  profileUrl: "https://example.com/northwind",
  avatarUrl: null,
});

const credentials = (token: string): ProviderCredentials => ({
  accessToken: token,
  refreshToken: null,
  expiresAt: null,
  scopes: ["w_member_social"],
});

describeDb("social accounts — moving between clients", () => {
  let staffId = "";
  let admin: Actor;
  let manager: Actor;
  let clientA = "";
  let clientB = "";
  let projectA = "";

  beforeAll(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true } })).id;
    admin = staff(staffId, ["social.view", "social.accounts.manage", "social.accounts.move"]);
    manager = staff(staffId, ["social.view", "social.accounts.manage"]);
    clientA = (await db.client.create({ data: { name: `A ${TAG}`, slug: `a-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    clientB = (await db.client.create({ data: { name: `B ${TAG}`, slug: `b-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    projectA = (
      await db.project.create({
        data: { code: `${TAG}`.slice(0, 20), name: "Retainer", clientId: clientA, managerId: staffId, startsAt: new Date() },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    if (!clientA) return;
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.notification.deleteMany({ where: { entityType: "SocialAccount", title: { contains: TAG } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  async function postOn(accountId: string, status: "SCHEDULED" | "PUBLISHED" | "DRAFT") {
    const item = await db.contentCalendarItem.create({
      data: { clientId: clientA, projectId: projectA, title: `${TAG} post`, channel: "LINKEDIN", stage: "APPROVED" },
      select: { id: true },
    });
    return db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId: clientA,
        accountId,
        provider: "LINKEDIN",
        type: "TEXT",
        status,
        caption: "Hello",
        hashtags: [],
        ...(status === "SCHEDULED" ? { scheduledFor: new Date(Date.now() + 3_600_000) } : {}),
        ...(status === "PUBLISHED" ? { publishedAt: new Date(), externalUrl: "https://example.com/post/1" } : {}),
      },
      select: { id: true },
    });
  }

  it("is an admin's power only", () => {
    // No seeded role but the admins holds it; SUPER_ADMIN bypasses in code.
    const holders = Object.entries(ROLE_PERMISSIONS)
      .filter(([, permissions]) => (permissions as string[]).includes("social.accounts.move"))
      .map(([role]) => role);
    expect(holders).toEqual(["ADMIN"]);
  });

  it("refuses staff without the move permission, and every portal user", async () => {
    const row = await connectAccount(admin, { clientId: clientA, provider: "LINKEDIN", account: account(`${TAG}-perm`), credentials: credentials("t-perm") });
    await expect(moveAccount(manager, row.id, clientB)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(moveTargets(manager, clientA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(moveAccount(portalUser(staffId, clientA), row.id, clientB)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses while the old client has a post scheduled through the account, and changes nothing", async () => {
    const row = await connectAccount(admin, { clientId: clientA, provider: "LINKEDIN", account: account(`${TAG}-busy`), credentials: credentials("t-busy") });
    await postOn(row.id, "SCHEDULED");

    await expect(moveAccount(admin, row.id, clientB)).rejects.toBeInstanceOf(ConflictError);
    const after = await db.socialAccount.findUniqueOrThrow({ where: { id: row.id }, select: { clientId: true, status: true } });
    expect(after).toEqual({ clientId: clientA, status: "CONNECTED" });
    expect((await credentialsFor(row.id))?.accessToken).toBe("t-busy");
  });

  it("refuses a move to the same client or to one that does not exist", async () => {
    const row = await connectAccount(admin, { clientId: clientA, provider: "LINKEDIN", account: account(`${TAG}-same`), credentials: credentials("t-same") });
    await expect(moveAccount(admin, row.id, clientA)).rejects.toBeInstanceOf(ValidationError);
    await expect(moveAccount(admin, row.id, "no-such-client")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("moves the account alone: the old client's posts stay its own, what was read is dropped, the credentials go", async () => {
    const row = await connectAccount(admin, { clientId: clientA, provider: "LINKEDIN", account: account(`${TAG}-move`), credentials: credentials("t-move-secret") });
    const published = await postOn(row.id, "PUBLISHED");
    const draft = await postOn(row.id, "DRAFT");
    await db.socialExternalPost.create({
      data: { clientId: clientA, accountId: row.id, provider: "LINKEDIN", externalPostId: `${TAG}-ext`, publishedAt: new Date() },
    });

    const moved = await moveAccount(admin, row.id, clientB);
    expect(moved.clientId).toBe(clientB);
    expect(moved.status).toBe("DISCONNECTED");
    expect(await credentialsFor(row.id)).toBeNull();

    // The old client's record is intact, just no longer tied to the account.
    const posts = await db.socialPost.findMany({
      where: { id: { in: [published.id, draft.id] } },
      select: { clientId: true, accountId: true, status: true, externalUrl: true },
    });
    expect(posts.every((p) => p.clientId === clientA && p.accountId === null)).toBe(true);
    expect(posts.find((p) => p.status === "PUBLISHED")?.externalUrl).toBe("https://example.com/post/1");
    expect(await db.socialExternalPost.count({ where: { accountId: row.id } })).toBe(0);

    // Audited as an assignment, with both clients and without a token.
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityType: "SocialAccount", entityId: row.id, action: "ASSIGN" },
      select: { before: true, after: true },
    });
    expect(audit.before).toMatchObject({ clientId: clientA });
    expect(audit.after).toMatchObject({ clientId: clientB });
    expect(JSON.stringify(audit)).not.toContain("t-move-secret");
  });

  it("lets the new client connect it, and keeps the old client out", async () => {
    const row = await connectAccount(admin, { clientId: clientA, provider: "LINKEDIN", account: account(`${TAG}-reconnect`), credentials: credentials("t-old") });
    await moveAccount(admin, row.id, clientB);

    await expect(
      connectAccount(admin, { clientId: clientA, provider: "LINKEDIN", account: account(`${TAG}-reconnect`), credentials: credentials("t-again") }),
    ).rejects.toBeInstanceOf(ConflictError);

    const reconnected = await connectAccount(admin, {
      clientId: clientB,
      provider: "LINKEDIN",
      account: account(`${TAG}-reconnect`),
      credentials: credentials("t-new"),
    });
    // The same row, now the new client's: one account, one history.
    expect(reconnected.id).toBe(row.id);
    expect(reconnected.clientId).toBe(clientB);
    expect(reconnected.status).toBe("CONNECTED");
  });

  it("offers every other client as a destination, never the one it is on", async () => {
    const targets = await moveTargets(admin, clientA);
    const ids = targets.map((t) => t.id);
    expect(ids).toContain(clientB);
    expect(ids).not.toContain(clientA);
  });
});

describeDb("social accounts — clients connecting from the portal", () => {
  let staffId = "";
  let admin: Actor;
  let clientA = "";
  let clientB = "";
  let portalA: PortalActor;
  let otherPortalA: PortalActor;
  let portalB: PortalActor;

  beforeAll(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true } })).id;
    admin = staff(staffId, ["social.view", "social.accounts.manage"]);
    clientA = (await db.client.create({ data: { name: `PA ${TAG}`, slug: `pa-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    clientB = (await db.client.create({ data: { name: `PB ${TAG}`, slug: `pb-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    const roleId = (await db.role.findFirstOrThrow({ where: { name: "CLIENT_USER" }, select: { id: true } })).id;
    const user = (email: string, clientId: string) =>
      db.user.create({ data: { email, name: "Portal", type: "CLIENT", status: "ACTIVE", clientId, roleId }, select: { id: true } });
    portalA = portalUser((await user(`pa-${TAG}@x.test`, clientA)).id, clientA);
    otherPortalA = portalUser((await user(`pa2-${TAG}@x.test`, clientA)).id, clientA);
    portalB = portalUser((await user(`pb-${TAG}@x.test`, clientB)).id, clientB);
  });

  afterAll(async () => {
    if (!clientA) return;
    await db.user.deleteMany({ where: { email: { endsWith: `-${TAG}@x.test` } } });
    await db.notification.deleteMany({ where: { userId: staffId, entityType: "SocialAccount", title: { startsWith: `PA ${TAG}` } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  it("connects an account for the portal user's own client and tells the client's owner", async () => {
    const row = await connectAccount(portalA, {
      clientId: clientA,
      provider: "INSTAGRAM",
      account: account(`${TAG}-ig`, "PA Instagram"),
      credentials: credentials("t-portal"),
    });
    expect(row.clientId).toBe(clientA);
    // "Connected by" names staff only; a client is never sent token news.
    expect(row.connectedBy).toBeNull();

    const notice = await db.notification.findFirst({
      where: { userId: staffId, entityType: "SocialAccount", entityId: row.id },
      select: { title: true, href: true },
    });
    expect(notice?.title).toBe(`PA ${TAG} connected Instagram`);
    expect(notice?.href).toBe(`/admin/clients/${clientA}/social/accounts`);
  });

  it("refuses a portal user connecting for another client", async () => {
    await expect(
      connectAccount(portalB, { clientId: clientA, provider: "FACEBOOK", account: account(`${TAG}-fb`), credentials: credentials("t-x") }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.socialAccount.count({ where: { externalId: `${TAG}-fb` } })).toBe(0);
  });

  it("refuses connecting an account another client holds", async () => {
    await connectAccount(admin, { clientId: clientB, provider: "X", account: account(`${TAG}-x`), credentials: credentials("t-b") });
    await expect(
      connectAccount(portalA, { clientId: clientA, provider: "X", account: account(`${TAG}-x`), credentials: credentials("t-a") }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("leaves the staff member who connected it in place when the client reconnects", async () => {
    const first = await connectAccount(admin, { clientId: clientA, provider: "YOUTUBE", account: account(`${TAG}-yt`), credentials: credentials("t-1") });
    expect(first.connectedBy?.id).toBe(staffId);
    const again = await connectAccount(portalA, { clientId: clientA, provider: "YOUTUBE", account: account(`${TAG}-yt`), credentials: credentials("t-2") });
    expect(again.id).toBe(first.id);
    expect(again.connectedBy?.id).toBe(staffId);
    expect((await credentialsFor(first.id))?.accessToken).toBe("t-2");
  });

  it("keeps a portal user's grant to that user: not staff, not a colleague, not another client", async () => {
    const id = await startPendingConnection(portalA, {
      clientId: clientA,
      provider: "FACEBOOK",
      credentials: credentials("t-grant"),
      accounts: [account(`${TAG}-page1`, "Page one"), account(`${TAG}-page2`, "Page two")],
      returnTo: "/portal/social/accounts",
    });

    const view = await getPendingConnection(portalA, id);
    expect(view.clientId).toBe(clientA);
    expect(JSON.stringify(view)).not.toContain("t-grant");

    await expect(getPendingConnection(otherPortalA, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getPendingConnection(portalB, id)).rejects.toBeInstanceOf(NotFoundError);
    // Staff with the same user id cannot be built from a real session, but the
    // kind of person is checked anyway.
    await expect(getPendingConnection(staff(portalA.userId, ["social.accounts.manage"]), id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a portal user starting a grant for another client", async () => {
    await expect(
      startPendingConnection(portalB, {
        clientId: clientA,
        provider: "FACEBOOK",
        credentials: credentials("t-y"),
        accounts: [account(`${TAG}-page3`)],
        returnTo: "/portal/social/accounts",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows a client only their own accounts, with no token and no platform error", async () => {
    await db.socialAccount.updateMany({ where: { externalId: `${TAG}-ig` }, data: { lastSyncError: "Error validating access token: secret-detail" } });
    const view = await portalSocialAccounts(portalA);
    expect(view.accounts.length).toBeGreaterThan(0);
    expect(view.accounts.every((a) => a.name.startsWith("PA") || a.name === "Northwind LinkedIn")).toBe(true);
    const payload = JSON.stringify(view);
    expect(payload).not.toContain("t-portal");
    expect(payload).not.toContain("secret-detail");
    expect(payload).not.toContain(`${TAG}-x`);

    const other = await portalSocialAccounts(portalB);
    expect(other.accounts.map((a) => a.id)).not.toContain(view.accounts[0]!.id);
  });
});
