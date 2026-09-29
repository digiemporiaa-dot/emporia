import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  cancelPendingConnection,
  completePendingConnection,
  getPendingConnection,
  startPendingConnection,
} from "@/lib/services/social-pending.service";
import { publishDuePosts, type ResolveAdapter } from "@/lib/services/social-publish.service";
import { collectMetrics } from "@/lib/services/social-metrics.service";
import { FacebookProvider } from "@/lib/social/facebook";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { decryptSecret, encryptSecret } from "@/lib/security/secret";
import { startFacebookDouble, type FacebookDouble } from "./support/facebook-double";
import type { Actor } from "@/lib/actor/types";

/**
 * Facebook inside the application.
 *
 * Most of this is the new step Facebook brought with it: a sign-in that
 * reaches several Pages waits, encrypted, for the operator to choose. The
 * tests pin who may finish that choice (only the person who signed in), what
 * may be chosen (only what was offered), and what is kept (never a Page
 * token, and nothing once it is used or stale).
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const SUFFIX = `fb-${Date.now()}`;

const MANAGE = ["social.view", "social.accounts.manage"];

function staff(userId: string, permissions = MANAGE): Actor {
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

describeDb("Facebook: choosing a Page, and publishing to it", () => {
  let double: FacebookDouble;
  let adapter: FacebookProvider;
  let resolve: ResolveAdapter;
  let operator: Actor;
  let colleague: Actor;
  let clientA = "";
  let clientB = "";
  let projectA = "";

  const userCredentials = { accessToken: "fb-long-user", refreshToken: null, expiresAt: null };

  async function start(clientId = clientA, now = new Date()) {
    const accounts = await adapter.listAccounts(userCredentials);
    return startPendingConnection(
      operator,
      {
        clientId,
        provider: "FACEBOOK",
        credentials: userCredentials,
        accounts,
        returnTo: `/admin/clients/${clientId}/social/accounts`,
      },
      now,
    );
  }

  beforeAll(async () => {
    double = await startFacebookDouble();
    adapter = new FacebookProvider({
      clientId: "fb-app-id",
      clientSecret: "fb-app-secret",
      dialogBase: double.url,
      graphBase: double.url,
      videoBase: double.url,
      ruploadBase: double.url,
      timeoutMs: 2_000,
    });
    resolve = async (which) => (which === "FACEBOOK" ? adapter : new UnconfiguredSocialProvider(which));

    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    operator = staff(user.id);
    // Same permissions, different person. The check compares identities, so
    // the colleague needs no row of their own.
    colleague = staff(`${SUFFIX}-colleague`);

    const [a, b] = await Promise.all([
      db.client.create({ data: { name: `${SUFFIX} A`, slug: `${SUFFIX}-a` }, select: { id: true } }),
      db.client.create({ data: { name: `${SUFFIX} B`, slug: `${SUFFIX}-b` }, select: { id: true } }),
    ]);
    clientA = a.id;
    clientB = b.id;

    const project = await db.project.create({
      data: {
        code: `F-${SUFFIX}`.slice(0, 20),
        name: "Retainer",
        clientId: clientA,
        managerId: operator.userId,
        startsAt: new Date(),
        status: "ACTIVE",
      },
      select: { id: true },
    });
    projectA = project.id;
  });

  afterEach(async () => {
    await db.socialMetricSnapshot.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialPublication.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialAccount.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.socialPendingConnection.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
  });

  afterAll(async () => {
    await double.close();
    await db.project.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  // -------------------------------------------------------------------------
  // What is kept while the operator chooses
  // -------------------------------------------------------------------------

  it("keeps the sign-in encrypted and offers only publishable Pages, with no token", async () => {
    const id = await start();
    const row = await db.socialPendingConnection.findUniqueOrThrow({ where: { id } });

    expect(row.credentials).not.toContain("fb-long-user");
    expect(JSON.parse(decryptSecret(row.credentials)!)).toMatchObject({ accessToken: "fb-long-user" });
    expect(JSON.stringify(row.options)).not.toContain("token");
    expect((row.options as { externalId: string }[]).map((o) => o.externalId)).toEqual(["1001", "1002"]);
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
  });

  it("shows the choice to the person who signed in, and to nobody else", async () => {
    const id = await start();

    const view = await getPendingConnection(operator, id);
    expect(view.options.map((o) => o.name)).toEqual(["Northwind Studio", "Northwind Outlet"]);
    expect(JSON.stringify(view)).not.toContain("fb-long-user");

    // Same permissions, different person: the grant is somebody else's login.
    await expect(getPendingConnection(colleague, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(completePendingConnection(colleague, id, "1001", resolve)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("needs the permission to manage accounts, and a staff member", async () => {
    const id = await start();
    await expect(getPendingConnection(staff(operator.userId, ["social.view"]), id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const portal: Actor = { ...operator, type: "CLIENT", clientId: clientA };
    await expect(getPendingConnection(portal, id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // -------------------------------------------------------------------------
  // Choosing
  // -------------------------------------------------------------------------

  it("connects the chosen Page with the Page's own token, and forgets the grant", async () => {
    const id = await start();
    const { account, returnTo } = await completePendingConnection(operator, id, "1002", resolve);

    expect(returnTo).toBe(`/admin/clients/${clientA}/social/accounts`);
    const stored = await db.socialAccount.findUniqueOrThrow({
      where: { id: account.id },
      select: { clientId: true, externalId: true, name: true, accessToken: true, refreshToken: true, tokenExpiresAt: true },
    });
    expect(stored).toMatchObject({ clientId: clientA, externalId: "1002", name: "Northwind Outlet" });
    expect(decryptSecret(stored.accessToken!)).toBe("page-token-1002");
    expect(stored.refreshToken).toBeNull();
    // A Page token does not expire; recording an expiry would trigger a
    // refresh Facebook does not offer.
    expect(stored.tokenExpiresAt).toBeNull();

    expect(await db.socialPendingConnection.count({ where: { id } })).toBe(0);
    await expect(completePendingConnection(operator, id, "1001", resolve)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("refuses a Page the sign-in did not offer, even one it could reach", async () => {
    const id = await start();
    // 1003 exists and the user can see it, but cannot post to it — it was
    // never offered, so it cannot be chosen by typing its id.
    await expect(completePendingConnection(operator, id, "1003", resolve)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await db.socialAccount.count({ where: { clientId: clientA } })).toBe(0);
  });

  it("marks a Page another client already has, without saying which client", async () => {
    await db.socialAccount.create({
      data: {
        clientId: clientB,
        provider: "FACEBOOK",
        externalId: "1001",
        name: "Northwind Studio",
        accessToken: encryptSecret("page-token-1001"),
      },
    });
    const id = await start();
    const view = await getPendingConnection(operator, id);
    const studio = view.options.find((o) => o.externalId === "1001")!;
    expect(studio).toMatchObject({ connectedElsewhere: true, connectedHere: false });
    expect(JSON.stringify(view)).not.toContain(clientB);
  });

  it("expires, and deletes itself when found expired", async () => {
    const id = await start(clientA, new Date(Date.now() - 16 * 60 * 1000));
    await expect(getPendingConnection(operator, id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.socialPendingConnection.count({ where: { id } })).toBe(0);
  });

  it("can be cancelled", async () => {
    const id = await start();
    await cancelPendingConnection(operator, id);
    expect(await db.socialPendingConnection.count({ where: { id } })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Publishing through the engine
  // -------------------------------------------------------------------------

  async function scheduledTextPost(accountId: string) {
    const item = await db.contentCalendarItem.create({
      data: { clientId: clientA, projectId: projectA, title: `${SUFFIX} hours`, channel: "FACEBOOK", stage: "APPROVED" },
      select: { id: true },
    });
    return db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId: clientA,
        accountId,
        provider: "FACEBOOK",
        type: "TEXT",
        status: "SCHEDULED",
        caption: "Festive hours this week: 10am to 9pm.",
        hashtags: ["festive"],
        scheduledFor: new Date(Date.now() - 60_000),
      },
      select: { id: true },
    });
  }

  it("publishes a scheduled post to the chosen Page and collects its numbers", async () => {
    const id = await start();
    const { account } = await completePendingConnection(operator, id, "1001", resolve);
    const post = await scheduledTextPost(account.id);

    const run = await publishDuePosts(new Date(), resolve);
    expect(run.published).toBe(1);
    const row = await db.socialPost.findUniqueOrThrow({
      where: { id: post.id },
      select: { status: true, externalPostId: true, externalUrl: true },
    });
    expect(row).toEqual({
      status: "PUBLISHED",
      externalPostId: "1001_900",
      externalUrl: "https://www.facebook.com/1001/posts/900",
    });

    // Posted as the Page, with the Page's token.
    const feed = double.requests.filter((r) => r.path.endsWith("/1001/feed")).at(-1)!;
    expect(JSON.parse(feed.body)).toMatchObject({ access_token: "page-token-1001" });

    const metrics = await collectMetrics(new Date(), resolve);
    expect(metrics.captured).toBe(1);
    const snapshot = await db.socialMetricSnapshot.findFirstOrThrow({
      where: { clientId: clientA },
      select: { likes: true, comments: true, shares: true, reach: true, clicks: true, impressions: true },
    });
    expect(snapshot).toEqual({ likes: 31, comments: 4, shares: 2, reach: 800, clicks: 37, impressions: null });
  });

  it("marks the Page for reconnection when Facebook rejects its token", async () => {
    const id = await start();
    const { account } = await completePendingConnection(operator, id, "1001", resolve);
    await scheduledTextPost(account.id);

    double.failWith("feed", 400, { error: { message: "Error validating access token", code: 190 } });
    await publishDuePosts(new Date(), resolve);

    const stored = await db.socialAccount.findUniqueOrThrow({ where: { id: account.id }, select: { status: true } });
    expect(stored.status).toBe("NEEDS_RECONNECT");
  });
});
