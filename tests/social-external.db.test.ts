import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import {
  directPostsForPeriod,
  directPostsSummary,
  EXTERNAL_METRICS_DAYS,
  importRecentPosts,
  listExternalPosts,
  MAX_METRIC_READS,
} from "@/lib/services/social-external.service";
import { syncAccount } from "@/lib/services/social-account.service";
import { periodSummary } from "@/lib/services/social-summary.service";
import { generateReport, getReport } from "@/lib/services/social-report.service";
import { readReportData, reportCsv } from "@/lib/social/report-doc";
import { CAPABILITIES } from "@/lib/social/capabilities";
import { CredentialsRejectedError } from "@/lib/social/errors";
import { encryptSecret } from "@/lib/security/secret";
import type { Actor, PortalActor } from "@/lib/actor/types";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { ProviderRecentPost, SocialProviderAdapter } from "@/lib/social/types";

/**
 * Posts made directly on the platforms, outside Emporia (brief §48), and the
 * separate line they get (the agency's choice: its own work stays the
 * headline).
 *
 * Pinned: a post Emporia published is recognised by its id or an alias and
 * never recorded; one recorded before Emporia's id landed is removed once
 * recognised; importing twice records once; figures are read only for recent
 * posts, only where the platform keeps them, never as a row of nulls, and at
 * most a bounded number per check; a platform that cannot list is not asked;
 * one post's failure skips that post, a rejected credential stops the import
 * and marks the account, anything else never fails the account check; each
 * client sees only its own; and the report carries them as their own line,
 * never in the agency's figures.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `ext${Date.now()}`;
const DAY = 86_400_000;
const credentials = { accessToken: "token", refreshToken: null, expiresAt: null };

function stub(provider: SocialProvider, over: Partial<SocialProviderAdapter> = {}): SocialProviderAdapter {
  const refuse = async (): Promise<never> => {
    throw new Error("not used in this test");
  };
  return {
    provider,
    label: provider,
    configured: true,
    capabilities: CAPABILITIES[provider],
    authorizationUrl: () => "",
    exchangeCode: refuse,
    refresh: refuse,
    getAccount: async () => ({ externalId: "x", name: "Account", username: null, profileUrl: null, avatarUrl: null }),
    publish: refuse,
    getMetrics: async () => ({ reach: 100, likes: 10, comments: 2 }),
    ...over,
  };
}

const post = (id: string, daysAgo: number, over: Partial<ProviderRecentPost> = {}): ProviderRecentPost => ({
  externalPostId: id,
  externalUrl: `https://platform.example/${id}`,
  caption: `Caption ${id}`,
  format: "IMAGE",
  thumbnailUrl: null,
  publishedAt: new Date(Date.now() - daysAgo * DAY),
  ...over,
});

describeDb("posts made outside Emporia", () => {
  let manager: Actor;
  let clientA = "";
  let clientB = "";
  /** The report's month holds only what that test puts there. */
  let clientC = "";
  let projectA = "";
  let userId = "";
  let counter = 0;

  async function account(clientId: string, provider: SocialProvider = "INSTAGRAM") {
    counter += 1;
    const row = await db.socialAccount.create({
      data: { clientId, provider, externalId: `${TAG}-${counter}`, name: `${TAG} ${provider} ${counter}`, status: "CONNECTED", accessToken: encryptSecret("token") },
      select: { id: true, clientId: true, provider: true, externalId: true, externalParentId: true },
    });
    return row;
  }

  async function emporiaPost(accountId: string, provider: SocialProvider, externalPostId: string) {
    const item = await db.contentCalendarItem.create({
      data: { clientId: clientA, projectId: projectA, title: `${TAG} agency post`, channel: "INSTAGRAM", stage: "PUBLISHED" },
      select: { id: true },
    });
    await db.socialPost.create({
      data: { contentItemId: item.id, clientId: clientA, accountId, provider, type: "SINGLE_IMAGE", status: "PUBLISHED", caption: "Ours", externalPostId, publishedAt: new Date() },
    });
  }

  const external = (accountId: string) =>
    db.socialExternalPost.findMany({ where: { accountId }, orderBy: { publishedAt: "desc" } });

  beforeAll(async () => {
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    userId = user.id;
    manager = {
      userId,
      name: "Manager",
      email: "m@emporia.test",
      type: "STAFF",
      roleName: "MARKETING_MANAGER",
      roleId: null,
      clientId: null,
      permissions: new Set(["social.view", "social.accounts.manage", "social.analytics.view", "social.reports.view", "social.reports.manage"]),
      ip: null,
      userAgent: "vitest",
    };
    clientA = (await db.client.create({ data: { name: `${TAG} A`, slug: `${TAG}-a` }, select: { id: true } })).id;
    clientB = (await db.client.create({ data: { name: `${TAG} B`, slug: `${TAG}-b` }, select: { id: true } })).id;
    clientC = (await db.client.create({ data: { name: `${TAG} C`, slug: `${TAG}-c` }, select: { id: true } })).id;
    projectA = (
      await db.project.create({
        data: { code: `E-${TAG}`.slice(0, 20), name: "Retainer", clientId: clientA, managerId: userId, startsAt: new Date(), status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    const clients = [clientA, clientB, clientC].filter(Boolean);
    await db.socialReport.deleteMany({ where: { clientId: { in: clients } } });
    await db.socialExternalPost.deleteMany({ where: { clientId: { in: clients } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: clients } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: clients } } });
    await db.socialAccount.deleteMany({ where: { clientId: { in: clients } } });
    await db.project.deleteMany({ where: { clientId: { in: clients } } });
    await db.client.deleteMany({ where: { id: { in: clients } } });
  });

  it("records posts Emporia did not publish, and recognises the ones it did, by id or alias", async () => {
    const ig = await account(clientA, "FACEBOOK");
    await emporiaPost(ig.id, "FACEBOOK", "ours-1");
    await emporiaPost(ig.id, "FACEBOOK", "video-555");
    const long = "x".repeat(900);
    const adapter = stub("FACEBOOK", {
      listRecentPosts: async () => [
        post("theirs-1", 2, { caption: long }),
        post("ours-1", 3),
        post("1001_900", 4, { aliases: ["video-555"] }),
        post("theirs-2", 20),
      ],
    });
    const result = await importRecentPosts(ig, adapter, credentials);
    expect(result).toEqual({ listed: 4, recorded: 2, recognised: 2, metricsRead: 1 });
    const rows = await external(ig.id);
    expect(rows.map((r) => r.externalPostId)).toEqual(["theirs-1", "theirs-2"]);
    expect(rows[0]).toMatchObject({ clientId: clientA, provider: "FACEBOOK", externalUrl: "https://platform.example/theirs-1" });
    expect(rows[0]!.caption).toHaveLength(500);
  });

  it("records once however often it runs, and keeps the details current", async () => {
    const ig = await account(clientA);
    let caption = "First words";
    const adapter = stub("INSTAGRAM", { listRecentPosts: async () => [post("again-1", 1, { caption })] });
    await importRecentPosts(ig, adapter, credentials);
    caption = "Edited on Instagram";
    await importRecentPosts(ig, adapter, credentials);
    const rows = await external(ig.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.caption).toBe("Edited on Instagram");
  });

  it("removes a post recorded before Emporia's id for it landed", async () => {
    const ig = await account(clientA);
    const adapter = stub("INSTAGRAM", { listRecentPosts: async () => [post("mid-publish", 0)] });
    await importRecentPosts(ig, adapter, credentials);
    expect(await external(ig.id)).toHaveLength(1);
    // Publication finishes and stores the id; the next check recognises it.
    await emporiaPost(ig.id, "INSTAGRAM", "mid-publish");
    const result = await importRecentPosts(ig, adapter, credentials);
    expect(result.recognised).toBe(1);
    expect(await external(ig.id)).toHaveLength(0);
  });

  it("reads figures only for recent posts, never as a row of nulls, and at most a bounded number", async () => {
    const ig = await account(clientA);
    const recent = Array.from({ length: MAX_METRIC_READS + 3 }, (_, i) => post(`recent-${ig.id}-${i}`, 1));
    const reads: string[] = [];
    const adapter = stub("INSTAGRAM", {
      // The silent one first, so it is read before the cap is reached.
      listRecentPosts: async () => [post(`silent-${ig.id}`, 1), ...recent, post(`older-${ig.id}`, EXTERNAL_METRICS_DAYS + 2)],
      getMetrics: async (_c, _a, id) => {
        reads.push(id);
        return id.startsWith("silent") ? { reach: null, likes: null } : { reach: 50, likes: 5, comments: 1, shares: 1, saves: 1 };
      },
    });
    const result = await importRecentPosts(ig, adapter, credentials);
    expect(result.recorded).toBe(MAX_METRIC_READS + 5);
    expect(result.metricsRead).toBe(MAX_METRIC_READS);
    expect(reads).not.toContain(`older-${ig.id}`);
    const rows = await external(ig.id);
    const measured = rows.filter((r) => r.metricsAt !== null);
    expect(measured).toHaveLength(MAX_METRIC_READS);
    expect(measured[0]).toMatchObject({ reach: 50, likes: 5 });
    expect(rows.find((r) => r.externalPostId === `older-${ig.id}`)!.metricsAt).toBeNull();
    // Asked, and the platform said nothing: still "never read", not a row of nulls dated today.
    expect(reads).toContain(`silent-${ig.id}`);
    expect(rows.find((r) => r.externalPostId === `silent-${ig.id}`)!.metricsAt).toBeNull();
  });

  it("does not ask for figures a platform does not keep, nor list where the platform cannot", async () => {
    const gbp = await account(clientA, "GOOGLE_BUSINESS_PROFILE");
    let metricCalls = 0;
    await importRecentPosts(
      gbp,
      stub("GOOGLE_BUSINESS_PROFILE", { listRecentPosts: async () => [post(`gbp-${gbp.id}`, 1)], getMetrics: async () => ((metricCalls += 1), {}) }),
      credentials,
    );
    expect(metricCalls).toBe(0);
    expect((await external(gbp.id))[0]!.metricsAt).toBeNull();

    const li = await account(clientA, "LINKEDIN");
    let listed = false;
    const result = await importRecentPosts(li, stub("LINKEDIN", { listRecentPosts: async () => ((listed = true), []) }), credentials);
    expect(listed).toBe(false);
    expect(result.listed).toBe(0);
  });

  it("skips one post's failed figures, but stops on rejected credentials", async () => {
    const ig = await account(clientA);
    const flaky = stub("INSTAGRAM", {
      listRecentPosts: async () => [post(`a-${ig.id}`, 1), post(`b-${ig.id}`, 1)],
      getMetrics: async (_c, _a, id) => {
        if (id.startsWith("a-")) throw new Error("Instagram had a bad minute");
        return { reach: 10 };
      },
    });
    const result = await importRecentPosts(ig, flaky, credentials);
    expect(result).toMatchObject({ recorded: 2, metricsRead: 1 });

    const rejected = stub("INSTAGRAM", {
      listRecentPosts: async () => [post(`c-${ig.id}`, 1)],
      getMetrics: async () => {
        throw new CredentialsRejectedError("Instagram rejected the credentials. Reconnect the account.");
      },
    });
    await expect(importRecentPosts(ig, rejected, credentials)).rejects.toBeInstanceOf(CredentialsRejectedError);
  });

  it("runs from the account check, which a failed listing never fails and a rejected credential does", async () => {
    const ig = await account(clientA);
    const resolveWith = (adapter: SocialProviderAdapter) => async () => adapter;

    expect(await syncAccount(manager, ig.id, resolveWith(stub("INSTAGRAM", { listRecentPosts: async () => [post(`sync-${ig.id}`, 1)] })))).toEqual({ ok: true });
    expect(await external(ig.id)).toHaveLength(1);

    const broken = stub("INSTAGRAM", {
      listRecentPosts: async () => {
        throw new Error("Instagram is having a moment");
      },
    });
    expect(await syncAccount(manager, ig.id, resolveWith(broken))).toEqual({ ok: true });
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id: ig.id } })).status).toBe("CONNECTED");

    const revoked = stub("INSTAGRAM", {
      listRecentPosts: async () => {
        throw new CredentialsRejectedError("Instagram rejected the credentials. Reconnect the account.");
      },
    });
    expect(await syncAccount(manager, ig.id, resolveWith(revoked))).toMatchObject({ ok: false });
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id: ig.id } })).status).toBe("NEEDS_RECONNECT");
  });

  it("keeps each client to its own direct posts", async () => {
    const theirs = await account(clientB);
    await importRecentPosts(theirs, stub("INSTAGRAM", { listRecentPosts: async () => [post(`b-only-${theirs.id}`, 1)] }), credentials);
    const listA = await listExternalPosts(manager, { clientId: clientA, provider: null, page: 1 });
    expect(listA.posts.some((p) => p.id && p.caption === `Caption b-only-${theirs.id}`)).toBe(false);
    const listB = await listExternalPosts(manager, { clientId: clientB, provider: null, page: 1 });
    expect(listB.posts.map((p) => p.caption)).toEqual([`Caption b-only-${theirs.id}`]);

    const portal: PortalActor = {
      userId,
      type: "CLIENT",
      name: "Client",
      email: "c@example.com",
      roleName: "CLIENT_USER",
      roleId: null,
      clientId: clientB,
      permissions: new Set<string>(),
      ip: null,
      userAgent: "vitest",
    };
    await expect(listExternalPosts(portal, { clientId: clientB, provider: null, page: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(directPostsForPeriod({ ...manager, permissions: new Set(["social.view"]) }, { clientId: clientA, from: null, to: new Date() })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("reports them as their own line, never in the agency's figures", async () => {
    const ig = await account(clientC);
    await db.socialExternalPost.createMany({
      data: [
        { clientId: clientC, accountId: ig.id, provider: "INSTAGRAM", externalPostId: `sep-1-${TAG}`, publishedAt: new Date("2026-09-10T06:00:00Z"), reach: 1000, likes: 40, comments: 5, metricsAt: new Date() },
        { clientId: clientC, accountId: ig.id, provider: "INSTAGRAM", externalPostId: `sep-2-${TAG}`, publishedAt: new Date("2026-09-20T06:00:00Z") },
        { clientId: clientC, accountId: ig.id, provider: "INSTAGRAM", externalPostId: `oct-1-${TAG}`, publishedAt: new Date("2026-10-02T06:00:00Z"), reach: 99 },
      ],
    });
    const from = new Date("2026-08-31T18:30:00Z");
    const to = new Date("2026-09-30T18:30:00Z");
    const direct = await directPostsSummary(clientC, from, to);
    expect(direct).toMatchObject({ posts: 2, measured: 1, reach: { value: 1000, reporting: 1, total: 2 }, engagement: { value: 45, reporting: 1, total: 2 } });
    // The agency's own figures for the same month are untouched.
    expect((await periodSummary(clientC, from, to)).posts).toBe(0);

    const { id } = await generateReport(manager, { clientId: clientC, month: "2026-09" }, new Date("2026-10-15T06:00:00Z"));
    const report = await getReport(manager, id);
    expect(report.data.current.posts).toBe(0);
    expect(report.data.direct).toMatchObject({ posts: 2, reach: { value: 1000 } });
    expect(reportCsv(report.data)).toContain("Posted directly on the platform,Posts,2");

    // A report frozen before this line existed still reads.
    const { direct: _dropped, ...older } = report.data;
    const reread = readReportData(older);
    expect(reread).not.toBeNull();
    expect(reread!.direct).toBeUndefined();
  });
});
