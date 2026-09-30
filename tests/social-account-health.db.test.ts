import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  accountHealth,
  accountWarnings,
  connectAccount,
  listAccounts,
  nextSyncAt,
  publishFailureStreaks,
  REPEATED_PUBLISH_FAILURES,
  SCHEDULED_SYNC_MS,
  SYNC_OVERDUE_MS,
  SYNC_RETRY_MS,
  syncAccount,
  syncDueAccounts,
  usableCredentials,
} from "@/lib/services/social-account.service";
import { completePendingConnection, startPendingConnection } from "@/lib/services/social-pending.service";
import { LinkedInProvider } from "@/lib/social/linkedin";
import { FacebookProvider } from "@/lib/social/facebook";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { encryptSecret } from "@/lib/security/secret";
import { startLinkedInDouble, type LinkedInDouble } from "./support/linkedin-double";
import { startFacebookDouble, type FacebookDouble } from "./support/facebook-double";
import type { Actor } from "@/lib/actor/types";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { SocialProviderAdapter } from "@/lib/social/types";

/**
 * Account health and sync (brief §36, §48).
 *
 * Pinned: an account holds only the permissions a platform said it granted —
 * never the requested list, and a check never overwrites them with it; a
 * missing publishing permission and repeated failed publications need
 * attention, an overdue check is a note; unknown permissions are never called
 * missing; the scheduled check covers stale connected accounts only, waits
 * after a failure instead of hammering, never marks an account on failures
 * alone, and does mark it when the platform rejects the credentials.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `hl7${Date.now()}`;
const HOUR = 3_600_000;

describe("when an account is next checked", () => {
  const created = new Date("2026-09-01T00:00:00Z");
  const good = new Date("2026-09-10T00:00:00Z");
  it("is a day after the last good check", () => {
    expect(nextSyncAt({ status: "CONNECTED", lastSyncedAt: good, lastCheckAttemptAt: good, createdAt: created })).toEqual(
      new Date(good.getTime() + SCHEDULED_SYNC_MS),
    );
    expect(nextSyncAt({ status: "CONNECTED", lastSyncedAt: null, createdAt: created })).toEqual(
      new Date(created.getTime() + SCHEDULED_SYNC_MS),
    );
  });

  it("waits the retry gap after a failed attempt", () => {
    const failed = new Date(good.getTime() + 30 * HOUR);
    expect(nextSyncAt({ status: "CONNECTED", lastSyncedAt: good, lastCheckAttemptAt: failed, createdAt: created })).toEqual(
      new Date(failed.getTime() + SYNC_RETRY_MS),
    );
  });

  it("is never for an account waiting on a person", () => {
    expect(nextSyncAt({ status: "NEEDS_RECONNECT", lastSyncedAt: good, createdAt: created })).toBeNull();
    expect(nextSyncAt({ status: "DISCONNECTED", lastSyncedAt: good, createdAt: created })).toBeNull();
  });
});

describe("account warnings", () => {
  const base = { status: "CONNECTED" as const, tokenExpiresAt: null, failureCount: 0, provider: "FACEBOOK" as const };

  it("needs attention when the platform did not grant the publishing permission", () => {
    const account = { ...base, scopes: ["pages_show_list"], scopesReportedAt: new Date() };
    expect(accountWarnings(account).map((w) => [w.kind, w.attention])).toEqual([["PERMISSION", true]]);
    expect(accountWarnings(account)[0]!.text).toContain("pages_manage_posts");
    expect(accountHealth(account)).toBe("ATTENTION");
  });

  it("does not call unknown permissions missing", () => {
    const account = { ...base, scopes: [], scopesReportedAt: null };
    expect(accountWarnings(account)).toEqual([]);
    expect(accountHealth(account)).toBe("HEALTHY");
  });

  it("needs attention after repeated failed publications, not after fewer", () => {
    expect(accountHealth({ ...base, publishFailureStreak: REPEATED_PUBLISH_FAILURES })).toBe("ATTENTION");
    expect(accountWarnings({ ...base, publishFailureStreak: REPEATED_PUBLISH_FAILURES })[0]!.text).toContain(
      `last ${REPEATED_PUBLISH_FAILURES} posts`,
    );
    expect(accountHealth({ ...base, publishFailureStreak: REPEATED_PUBLISH_FAILURES - 1 })).toBe("HEALTHY");
  });

  it("notes an overdue check without changing the health", () => {
    const now = new Date();
    const stale = { ...base, lastSyncedAt: new Date(now.getTime() - SYNC_OVERDUE_MS - HOUR) };
    expect(accountWarnings(stale, now).map((w) => [w.kind, w.attention])).toEqual([["SYNC_OVERDUE", false]]);
    expect(accountHealth(stale)).toBe("HEALTHY");
    expect(accountWarnings({ ...base, lastSyncedAt: new Date(now.getTime() - SYNC_OVERDUE_MS + HOUR) }, now)).toEqual([]);
  });

  it("needs attention when the platform is not configured, instead of blaming the scheduled job", () => {
    const now = new Date();
    const stale = { ...base, lastSyncedAt: new Date(now.getTime() - SYNC_OVERDUE_MS - HOUR) };
    const warnings = accountWarnings({ ...stale, providerConfigured: false }, now);
    expect(warnings.map((w) => [w.kind, w.attention])).toEqual([["NOT_CONFIGURED", true]]);
    expect(warnings[0]!.text).toContain("Facebook is not configured");
    expect(accountHealth({ ...base, providerConfigured: false })).toBe("ATTENTION");
    // Unknown is not "not configured".
    expect(accountHealth({ ...base })).toBe("HEALTHY");
    expect(accountWarnings({ ...stale, providerConfigured: true }, now).map((w) => w.kind)).toEqual(["SYNC_OVERDUE"]);
  });

  it("says nothing about a disconnected account", () => {
    expect(accountWarnings({ ...base, status: "DISCONNECTED", scopes: [], scopesReportedAt: new Date(), publishFailureStreak: 9 })).toEqual([]);
  });
});

describeDb("account permissions and scheduled checks", () => {
  let li: LinkedInDouble;
  let fb: FacebookDouble;
  let linkedin: LinkedInProvider;
  let facebook: FacebookProvider;
  let resolve: (provider: SocialProvider) => Promise<SocialProviderAdapter>;
  let manager: Actor;
  let clientId = "";
  let projectId = "";
  let counter = 0;

  async function account(over: { lastSyncedAt?: Date | null; lastCheckAttemptAt?: Date | null; status?: "CONNECTED" | "NEEDS_RECONNECT"; provider?: SocialProvider } = {}) {
    counter += 1;
    return (
      await db.socialAccount.create({
        data: {
          clientId,
          provider: over.provider ?? "LINKEDIN",
          externalId: `${TAG}-${counter}`,
          name: `${TAG} account ${counter}`,
          status: over.status ?? "CONNECTED",
          accessToken: encryptSecret("li-access-token"),
          lastSyncedAt: over.lastSyncedAt === undefined ? new Date(Date.now() - 2 * SCHEDULED_SYNC_MS) : over.lastSyncedAt,
          lastCheckAttemptAt: over.lastCheckAttemptAt ?? null,
        },
        select: { id: true },
      })
    ).id;
  }
  const row = (id: string) => db.socialAccount.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    [li, fb] = await Promise.all([startLinkedInDouble(), startFacebookDouble()]);
    linkedin = new LinkedInProvider({
      clientId: "li-app",
      clientSecret: "li-secret",
      authBase: `${li.url}/oauth/v2`,
      apiBase: `${li.url}/v2`,
      restBase: `${li.url}/rest`,
    });
    facebook = new FacebookProvider({ clientId: "fb-app", clientSecret: "fb-secret", dialogBase: fb.url, graphBase: fb.url, videoBase: fb.url, ruploadBase: fb.url, timeoutMs: 2_000 });
    resolve = async (which) => (which === "LINKEDIN" ? linkedin : which === "FACEBOOK" ? facebook : new UnconfiguredSocialProvider(which));

    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    manager = {
      userId: user.id,
      name: "Manager",
      email: "m@emporia.test",
      type: "STAFF",
      roleName: "MARKETING_MANAGER",
      roleId: null,
      clientId: null,
      permissions: new Set(["social.view", "social.accounts.manage"]),
      ip: null,
      userAgent: "vitest",
    };
    clientId = (await db.client.create({ data: { name: `${TAG} client`, slug: `${TAG}-a` }, select: { id: true } })).id;
    projectId = (
      await db.project.create({
        data: { code: `H-${TAG}`.slice(0, 20), name: "Retainer", clientId, managerId: user.id, startsAt: new Date(), status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    if (clientId) {
      await db.socialPublication.deleteMany({ where: { clientId } });
      await db.socialPost.deleteMany({ where: { clientId } });
      await db.contentCalendarItem.deleteMany({ where: { clientId } });
      await db.socialPendingConnection.deleteMany({ where: { clientId } });
      await db.notification.deleteMany({ where: { entityType: "SocialAccount", entityId: { in: (await db.socialAccount.findMany({ where: { clientId }, select: { id: true } })).map((a) => a.id) } } });
      await db.socialAccount.deleteMany({ where: { clientId } });
      await db.project.deleteMany({ where: { clientId } });
      await db.client.deleteMany({ where: { id: clientId } });
    }
    await Promise.all([li?.close(), fb?.close()]);
  });

  it("stores only what the platform granted, and a check never replaces it with the requested list", async () => {
    const connected = await connectAccount(manager, {
      clientId,
      provider: "LINKEDIN",
      account: await linkedin.getAccount({ accessToken: "li-access-token", refreshToken: null, expiresAt: null }),
      credentials: { accessToken: "li-access-token", refreshToken: null, expiresAt: null, scopes: ["openid", "profile"] },
    });
    let stored = await row(connected.id);
    expect(stored.scopes).toEqual(["openid", "profile"]);
    expect(stored.scopesReportedAt).not.toBeNull();

    // The Check button: the profile is re-read, the grant is not overwritten.
    expect(await syncAccount(manager, connected.id, resolve)).toEqual({ ok: true });
    stored = await row(connected.id);
    expect(stored.scopes).toEqual(["openid", "profile"]);
    expect(accountHealth({ ...stored, renewsItself: false })).toBe("ATTENTION");

    // Reconnected through a flow that does not report: the old answer goes.
    await connectAccount(manager, {
      clientId,
      provider: "LINKEDIN",
      account: await linkedin.getAccount({ accessToken: "li-access-token", refreshToken: null, expiresAt: null }),
      credentials: { accessToken: "li-access-token", refreshToken: null, expiresAt: null },
    });
    stored = await row(connected.id);
    expect(stored.scopes).toEqual([]);
    expect(stored.scopesReportedAt).toBeNull();
  });

  it("updates the grant when a renewal reports one, and keeps it when a renewal does not", async () => {
    const id = await account();
    await db.socialAccount.update({
      where: { id },
      data: { refreshToken: encryptSecret("li-refresh-token"), tokenExpiresAt: new Date(Date.now() + 60_000), scopes: ["openid"], scopesReportedAt: new Date(0) },
    });
    await usableCredentials(id, linkedin);
    let stored = await row(id);
    expect(stored.scopes).toEqual(["email", "openid", "profile", "w_member_social"]);
    expect(stored.scopesReportedAt!.getTime()).toBeGreaterThan(0);

    li.token({ access_token: "li-access-2", refresh_token: "li-refresh-2", expires_in: 60 });
    await db.socialAccount.update({ where: { id }, data: { tokenExpiresAt: new Date(Date.now() + 60_000) } });
    await usableCredentials(id, linkedin);
    stored = await row(id);
    expect(stored.scopes).toEqual(["email", "openid", "profile", "w_member_social"]);
  });

  it("carries what Facebook granted through the choose-a-Page step to the Page", async () => {
    fb.permissions([
      { permission: "pages_show_list", status: "granted" },
      { permission: "pages_manage_posts", status: "declined" },
    ]);
    const credentials = await facebook.exchangeCode("the-code", "https://emporia.test/cb");
    const pending = await startPendingConnection(manager, {
      clientId,
      provider: "FACEBOOK",
      credentials,
      accounts: await facebook.listAccounts(credentials),
      returnTo: `/admin/clients/${clientId}/social/accounts`,
    });
    const { account: page } = await completePendingConnection(manager, pending, "1001", resolve);
    const stored = await row(page.id);
    expect(stored.scopes).toEqual(["pages_show_list"]);
    const [listed] = (await listAccounts(manager, clientId)).filter((a) => a.id === page.id);
    expect(accountWarnings(listed!).map((w) => w.kind)).toContain("PERMISSION");
  });

  it("counts failed publications in a row, most recent first, ending at a success", async () => {
    const id = await account();
    const item = await db.contentCalendarItem.create({
      data: { clientId, projectId, title: `${TAG} idea`, channel: "LINKEDIN", stage: "APPROVED" },
      select: { id: true },
    });
    const post = await db.socialPost.create({
      data: { contentItemId: item.id, clientId, accountId: id, provider: "LINKEDIN", type: "TEXT", status: "FAILED", caption: "Copy." },
      select: { id: true },
    });
    const publication = (status: "PUBLISHED" | "FAILED" | "PUBLISHING", minutesAgo: number) =>
      db.socialPublication.create({
        data: {
          postId: post.id,
          clientId,
          provider: "LINKEDIN",
          status,
          idempotencyKey: `${TAG}-${minutesAgo}-${status}`,
          attemptedAt: new Date(Date.now() - minutesAgo * 60_000),
        },
      });
    await publication("PUBLISHED", 60);
    await publication("FAILED", 50);
    await publication("FAILED", 40);
    expect((await publishFailureStreaks([id])).get(id)).toBe(2);
    await publication("FAILED", 30);
    // Still in flight: neither a failure nor a success.
    await publication("PUBLISHING", 20);
    expect((await publishFailureStreaks([id])).get(id)).toBe(3);
    const [listed] = (await listAccounts(manager, clientId)).filter((a) => a.id === id);
    expect(listed!.publishFailureStreak).toBe(3);
    expect(accountHealth(listed!)).toBe("ATTENTION");
    await publication("PUBLISHED", 10);
    expect((await publishFailureStreaks([id])).get(id)).toBe(0);
  });

  it("checks stale connected accounts only, and skips platforms not configured", async () => {
    const stale = await account();
    const fresh = await account({ lastSyncedAt: new Date(Date.now() - HOUR) });
    const marked = await account({ status: "NEEDS_RECONNECT" });
    const unconfigured = await account({ provider: "X" });
    const before = new Date();

    await syncDueAccounts(resolve, new Date(), { clientId });
    expect((await row(stale)).lastSyncedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect((await row(fresh)).lastSyncedAt!.getTime()).toBeLessThan(before.getTime());
    expect((await row(marked)).lastCheckAttemptAt).toBeNull();
    const x = await row(unconfigured);
    expect(x.lastCheckAttemptAt).toBeNull();
    expect(x.failureCount).toBe(0);
  });

  it("keeps a run limited to one client away from every other client's accounts", async () => {
    const other = await db.client.create({ data: { name: `${TAG} other`, slug: `${TAG}-b` }, select: { id: true } });
    try {
      const theirs = await db.socialAccount.create({
        data: { clientId: other.id, provider: "LINKEDIN", externalId: `${TAG}-other`, name: "Theirs", status: "CONNECTED", accessToken: encryptSecret("x"), lastSyncedAt: null },
        select: { id: true },
      });
      await syncDueAccounts(resolve, new Date(), { clientId });
      expect((await row(theirs.id)).lastCheckAttemptAt).toBeNull();
    } finally {
      await db.socialAccount.deleteMany({ where: { clientId: other.id } });
      await db.client.delete({ where: { id: other.id } });
    }
  });

  it("waits the retry gap after a failure, and never marks an account on failures alone", async () => {
    const id = await account();
    const only = async (now: Date) => {
      // This file's other accounts may be due too; this test is about one.
      await db.socialAccount.updateMany({ where: { clientId, id: { not: id } }, data: { lastSyncedAt: new Date(Date.now() + SCHEDULED_SYNC_MS) } });
      return syncDueAccounts(resolve, now, { clientId });
    };

    li.failWith("userinfo", 500, "{}");
    await only(new Date());
    let stored = await row(id);
    expect(stored.failureCount).toBe(1);
    expect(stored.lastCheckAttemptAt).not.toBeNull();

    // The next cron run, minutes later: not asked again.
    li.failWith("userinfo", 500, "{}");
    await only(new Date(Date.now() + 5 * 60_000));
    expect((await row(id)).failureCount).toBe(1);

    // After the gap, and failing again — twice more.
    for (let i = 1; i <= 2; i += 1) {
      li.failWith("userinfo", 500, "{}");
      await db.socialAccount.update({ where: { id }, data: { lastCheckAttemptAt: new Date(Date.now() - SYNC_RETRY_MS - HOUR) } });
      await only(new Date());
    }
    stored = await row(id);
    expect(stored.failureCount).toBe(3);
    expect(stored.status).toBe("CONNECTED");
  });

  it("marks the account when the platform rejects the credentials", async () => {
    const id = await account();
    await db.socialAccount.updateMany({ where: { clientId, id: { not: id } }, data: { lastSyncedAt: new Date(Date.now() + SCHEDULED_SYNC_MS) } });
    li.failWith("userinfo", 401, "{}");
    const run = await syncDueAccounts(resolve, new Date(), { clientId });
    expect(run.failed).toBeGreaterThanOrEqual(1);
    expect((await row(id)).status).toBe("NEEDS_RECONNECT");
  });
});
