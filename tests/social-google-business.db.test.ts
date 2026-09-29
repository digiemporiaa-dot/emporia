import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  completePendingConnection,
  getPendingConnection,
  startPendingConnection,
} from "@/lib/services/social-pending.service";
import { publishDuePosts, type ResolveAdapter } from "@/lib/services/social-publish.service";
import { collectMetrics } from "@/lib/services/social-metrics.service";
import { syncAccount } from "@/lib/services/social-account.service";
import { GoogleBusinessProvider } from "@/lib/social/google-business";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { decryptSecret, encryptSecret } from "@/lib/security/secret";
import { startGoogleBusinessDouble, type GoogleBusinessDouble } from "./support/google-business-double";
import type { Actor } from "@/lib/actor/types";

/**
 * Business Profile inside the application: choosing a location through the
 * picker Facebook introduced, posting through the account the location was
 * offered under, metrics honestly skipped — and the accounts screen's "check"
 * button, which used to test a Google connection with a stale token.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const SUFFIX = `gbp-${Date.now()}`;

describeDb("Google Business Profile: choosing a location, and posting to it", () => {
  let double: GoogleBusinessDouble;
  let adapter: GoogleBusinessProvider;
  let resolve: ResolveAdapter;
  let operator: Actor;
  let clientId = "";
  let projectId = "";

  const google = { accessToken: "gbp-access", refreshToken: "gbp-refresh", expiresAt: new Date(Date.now() + 3_599_000) };

  beforeAll(async () => {
    double = await startGoogleBusinessDouble();
    adapter = new GoogleBusinessProvider({
      clientId: "gbp-client",
      clientSecret: "gbp-secret",
      tokenUrl: `${double.url}/token`,
      accountsBase: double.url,
      infoBase: double.url,
      postsBase: double.url,
      timeoutMs: 2_000,
    });
    resolve = async (which) =>
      which === "GOOGLE_BUSINESS_PROFILE" ? adapter : new UnconfiguredSocialProvider(which);

    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    operator = {
      userId: user.id,
      name: "Social",
      email: "social@emporia.test",
      type: "STAFF",
      roleName: "MARKETING_MANAGER",
      roleId: null,
      clientId: null,
      permissions: new Set(["social.view", "social.accounts.manage"]),
      ip: null,
      userAgent: "vitest",
    };

    const client = await db.client.create({ data: { name: `${SUFFIX} Northwind`, slug: `${SUFFIX}-a` }, select: { id: true } });
    clientId = client.id;
    const project = await db.project.create({
      data: { code: `G-${SUFFIX}`.slice(0, 20), name: "Retainer", clientId, managerId: user.id, startsAt: new Date(), status: "ACTIVE" },
      select: { id: true },
    });
    projectId = project.id;
  });

  afterEach(async () => {
    await db.socialMetricSnapshot.deleteMany({ where: { clientId } });
    await db.socialPublication.deleteMany({ where: { clientId } });
    await db.socialPost.deleteMany({ where: { clientId } });
    await db.contentCalendarItem.deleteMany({ where: { clientId } });
    await db.socialAccount.deleteMany({ where: { clientId } });
    await db.socialPendingConnection.deleteMany({ where: { clientId } });
  });

  afterAll(async () => {
    await double.close();
    await db.project.deleteMany({ where: { clientId } });
    await db.client.deleteMany({ where: { id: clientId } });
  });

  async function connectLocation(externalId = "locations/1002") {
    const accounts = await adapter.listAccounts(google);
    const id = await startPendingConnection(operator, {
      clientId,
      provider: "GOOGLE_BUSINESS_PROFILE",
      credentials: google,
      accounts,
      returnTo: `/admin/clients/${clientId}/social/accounts`,
    });
    return completePendingConnection(operator, id, externalId, resolve);
  }

  it("connects the chosen location with its account and the person's lasting Google access", async () => {
    const accounts = await adapter.listAccounts(google);
    const pending = await startPendingConnection(operator, {
      clientId,
      provider: "GOOGLE_BUSINESS_PROFILE",
      credentials: google,
      accounts,
      returnTo: `/admin/clients/${clientId}/social/accounts`,
    });
    const view = await getPendingConnection(operator, pending);
    expect(view.options.map((o) => o.name)).toEqual(["Northwind Studio — Bandra", "Northwind Studio — Andheri"]);

    const { account } = await completePendingConnection(operator, pending, "locations/1002", resolve);
    const stored = await db.socialAccount.findUniqueOrThrow({
      where: { id: account.id },
      select: { externalId: true, externalParentId: true, name: true, accessToken: true, refreshToken: true, tokenExpiresAt: true },
    });
    expect(stored).toMatchObject({
      externalId: "locations/1002",
      externalParentId: "accounts/111",
      name: "Northwind Studio — Andheri",
    });
    expect(decryptSecret(stored.accessToken!)).toBe("gbp-access");
    expect(decryptSecret(stored.refreshToken!)).toBe("gbp-refresh");
    expect(stored.tokenExpiresAt).not.toBeNull();
  });

  it("publishes a scheduled post through the location's account, renewing the token first", async () => {
    const { account } = await connectLocation();
    // Most of the hour gone.
    await db.socialAccount.update({ where: { id: account.id }, data: { tokenExpiresAt: new Date(Date.now() + 5 * 60_000) } });

    const item = await db.contentCalendarItem.create({
      data: { clientId, projectId, title: `${SUFFIX} hours`, channel: "INSTAGRAM", stage: "APPROVED" },
      select: { id: true },
    });
    const post = await db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId,
        accountId: account.id,
        provider: "GOOGLE_BUSINESS_PROFILE",
        type: "GBP_POST",
        status: "SCHEDULED",
        caption: "Festive hours this week: 10am to 9pm.",
        callToAction: "LEARN_MORE",
        linkUrl: "https://northwind.test/hours",
        scheduledFor: new Date(Date.now() - 60_000),
      },
      select: { id: true },
    });

    const from = double.requests.length;
    const run = await publishDuePosts(new Date(), resolve);
    expect(run.published).toBe(1);

    const created = double.requests.slice(from).find((r) => r.path.endsWith("/localPosts"))!;
    expect(created.path).toBe("/v4/accounts/111/locations/1002/localPosts");
    expect(created.headers.authorization).toBe("Bearer gbp-access-2");
    const sent = JSON.parse(created.body) as { callToAction: { url: string } };
    // The engine tags the link; the adapter only carries it.
    expect(sent.callToAction.url).toContain("northwind.test/hours");

    const row = await db.socialPost.findUniqueOrThrow({
      where: { id: post.id },
      select: { status: true, externalPostId: true, externalUrl: true },
    });
    expect(row).toEqual({
      status: "PUBLISHED",
      externalPostId: "accounts/111/locations/1002/localPosts/555",
      externalUrl: "https://local.google.com/place?use=posts&lpsid=555",
    });

    // No per-post metrics exist, so none are asked for or recorded.
    const before = double.requests.length;
    const metrics = await collectMetrics(new Date(), resolve);
    expect(metrics.captured).toBe(0);
    expect(double.requests.length).toBe(before);
    expect(await db.socialMetricSnapshot.count({ where: { clientId } })).toBe(0);
  });

  it("checks a connection with a renewed token, not the stale one it has stored", async () => {
    const { account } = await connectLocation();
    // Idle past its hour: the stored access token is dead.
    await db.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date(Date.now() - 60_000), accessToken: encryptSecret("gbp-stale") },
    });

    const from = double.requests.length;
    const result = await syncAccount(operator, account.id, resolve);
    expect(result).toEqual({ ok: true });

    const read = double.requests.slice(from).find((r) => r.path === "/v1/locations/1002")!;
    expect(read.headers.authorization).toBe("Bearer gbp-access-2");
    const stored = await db.socialAccount.findUniqueOrThrow({ where: { id: account.id }, select: { status: true } });
    expect(stored.status).toBe("CONNECTED");
  });
});
