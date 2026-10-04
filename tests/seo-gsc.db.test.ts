import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, RateLimitedError, ValidationError } from "@/lib/errors";
import { decryptSecret } from "@/lib/security/secret";
import { clearServiceAccountTokens } from "@/lib/seo-intel/google/service-account";
import { SEO_GOOGLE_SETTING } from "@/lib/seo-intel/google/settings";
import { SeoAccessError, SeoCredentialsError, SeoRateLimitError } from "@/lib/seo-intel/providers/errors";
import { addDays, GSC_TIME_ZONE, todayIn, toDbDate } from "@/lib/seo-intel/dates";
import { createProperty } from "@/lib/services/seo-intel/property.service";
import { getGoogleSettings, googleMethodsAvailable, saveGoogleSettings } from "@/lib/services/seo-intel/google-settings.service";
import {
  chooseGscSite,
  completeGscOAuth,
  connectGscWithServiceAccount,
  disconnectGsc,
  getGscConnection,
  listGscSites,
} from "@/lib/services/seo-intel/gsc-connection.service";
import { syncDueGscProperties, syncGscNow, syncGscProperty } from "@/lib/services/seo-intel/gsc-sync.service";
import { getSEOOverview, listGscRows } from "@/lib/services/seo-intel/overview.service";
import { seoGoogleSettingsSchema, seoPropertyCreateSchema } from "@/lib/validation/seo-intel";
import type { GscQueryInput, GscRawRow, SearchConsoleProvider } from "@/lib/seo-intel/providers/types";
import type { Actor } from "@/lib/actor/types";

/**
 * SEO Phase 2 against the database: credentials stay secret, a site is only
 * attached when it is really this website's, syncs are idempotent and honest
 * about failure, and the overview's numbers are exactly what was stored —
 * for this property and no other.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `gs${Date.now().toString(36)}`;

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SA_EMAIL = `emporia-${TAG}@agency.iam.gserviceaccount.com`;
const KEY_FILE = JSON.stringify({ type: "service_account", client_email: SA_EMAIL, private_key: PEM, private_key_id: "kid" });
const OAUTH_ID = `${TAG}.apps.googleusercontent.com`;
const OAUTH_SECRET = `secret-${TAG}`;

/** A Search Console that answers every query from a function of the day. */
function fakeGsc(opts: { failAfterCalls?: number; error?: Error; clicks?: (day: string) => number } = {}) {
  const calls: GscQueryInput[] = [];
  const clicks = opts.clicks ?? (() => 10);
  const provider: SearchConsoleProvider = {
    listSites: async () => [],
    query: async (input) => {
      calls.push(input);
      if (opts.failAfterCalls !== undefined && calls.length > opts.failAfterCalls) throw opts.error ?? new SeoRateLimitError(60);
      if ((input.startRow ?? 0) > 0) return [];
      const days: string[] = [];
      for (let day = input.startDate; day <= input.endDate; day = addDays(day, 1)) days.push(day);
      const dims = input.dimensions.join(",");
      const rows: GscRawRow[] = [];
      for (const day of days) {
        const c = clicks(day);
        if (dims === "date") rows.push({ keys: [day], clicks: c, impressions: c * 20, position: 8 });
        if (dims === "date,device") rows.push({ keys: [day, "MOBILE"], clicks: c, impressions: c * 20, position: 8 });
        if (dims === "date,country") rows.push({ keys: [day, "ind"], clicks: c, impressions: c * 20, position: 8 });
        if (dims === "query") rows.push({ keys: ["seo agency"], clicks: c, impressions: c * 10, position: 4 }, { keys: ["marketing"], clicks: 0, impressions: 50, position: 15 });
        if (dims === "page") rows.push({ keys: ["https://site.example.org/services"], clicks: c, impressions: c * 20, position: 5 });
        if (dims === "query,page") rows.push({ keys: ["seo agency", "https://site.example.org/services"], clicks: c, impressions: c * 10, position: 4 });
      }
      return rows;
    },
  };
  return { provider, calls };
}

describeDb("SEO Search Console", () => {
  let userId = "";
  let clientA = "";
  let clientB = "";
  let propA = "";
  let propB = "";

  const actor = (permissions: string[], overrides: Partial<Actor> = {}): Actor =>
    ({
      userId,
      name: "GSC Tester",
      email: "gsc@test.example",
      type: "STAFF",
      roleName: "ADMIN",
      roleId: "r",
      clientId: null,
      ip: null,
      userAgent: null,
      permissions: new Set(permissions),
      ...overrides,
    }) as Actor;
  const admin = () => actor(["seo.intelligence.view", "seo.intelligence.manage", "seo.intelligence.connect"]);
  const viewer = () => actor(["seo.intelligence.view"]);

  async function resetConnection(propertyId: string) {
    await db.seoConnection.deleteMany({ where: { propertyId } });
    await db.gscDailyTotal.deleteMany({ where: { propertyId } });
    await db.gscQueryDaily.deleteMany({ where: { propertyId } });
    await db.gscPageDaily.deleteMany({ where: { propertyId } });
    await db.seoSyncRun.deleteMany({ where: { propertyId } });
  }

  async function connected(propertyId: string, extra: Record<string, unknown> = {}) {
    await resetConnection(propertyId);
    return db.seoConnection.create({
      data: { propertyId, source: "SEARCH_CONSOLE", method: "SERVICE_ACCOUNT", status: "CONNECTED", externalId: "sc-domain:site.example.org", ...extra },
    });
  }

  /** Route Google's endpoints for code that uses the global fetch. */
  function stubGoogle(routes: (url: string, init?: RequestInit) => Response | undefined) {
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const response = routes(url, init);
      if (response) return response;
      throw new Error(`unexpected fetch to ${url}`);
    });
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  beforeAll(async () => {
    userId = (await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } })).id;
    const [a, b] = await Promise.all(
      ["A", "B"].map((x) => db.client.create({ data: { name: `GSC ${x} ${TAG}`, slug: `gsc-${x.toLowerCase()}-${TAG}` }, select: { id: true } })),
    );
    clientA = a!.id;
    clientB = b!.id;
    const form = (owner: string, website: string) =>
      seoPropertyCreateSchema.parse({ owner, website, protocol: "HTTPS", displayName: `GSC ${website}`, defaultLanguage: "en", timezone: "UTC", isActive: true });
    propA = (await createProperty(admin(), form(clientA, "site.example.org"))).id;
    propB = (await createProperty(admin(), form(clientB, "other.example.net"))).id;
    await db.integrationSetting.deleteMany({ where: { provider: SEO_GOOGLE_SETTING } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearServiceAccountTokens();
  });

  afterAll(async () => {
    for (const id of [propA, propB]) await resetConnection(id);
    await db.rateLimitWindow.deleteMany({ where: { key: { in: [`seo-sync:${propA}`, `seo-sync:${propB}`] } } });
    await db.auditLog.deleteMany({ where: { entityId: { in: [propA, propB, SEO_GOOGLE_SETTING] }, actorId: userId } });
    await db.seoProperty.deleteMany({ where: { id: { in: [propA, propB] } } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
    await db.integrationSetting.deleteMany({ where: { provider: SEO_GOOGLE_SETTING } });
  });

  // ---------------------------------------------------------------------------
  // The agency's Google credentials
  // ---------------------------------------------------------------------------

  describe("Google settings", () => {
    it("needs seo.intelligence.connect to read or change", async () => {
      await expect(getGoogleSettings(actor(["seo.intelligence.view", "seo.intelligence.manage", "settings.edit"]))).rejects.toBeInstanceOf(ForbiddenError);
      await expect(saveGoogleSettings(viewer(), seoGoogleSettingsSchema.parse({ oauthClientId: OAUTH_ID, oauthClientSecret: "x" }))).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("encrypts both secrets; the view and the audit say only that they exist", async () => {
      const view = await saveGoogleSettings(admin(), seoGoogleSettingsSchema.parse({ oauthClientId: OAUTH_ID, oauthClientSecret: OAUTH_SECRET, serviceAccountJson: KEY_FILE }));
      expect(view).toMatchObject({ oauthClientId: OAUTH_ID, oauthSecretConfigured: true, serviceAccountEmail: SA_EMAIL, serviceAccountKeyConfigured: true });
      expect(JSON.stringify(view)).not.toContain(OAUTH_SECRET);
      expect(JSON.stringify(view)).not.toContain("PRIVATE KEY");

      const row = await db.integrationSetting.findUniqueOrThrow({ where: { provider: SEO_GOOGLE_SETTING } });
      const config = row.config as Record<string, string>;
      expect(config["oauthClientSecret"]).not.toContain(OAUTH_SECRET);
      expect(decryptSecret(config["oauthClientSecret"])).toBe(OAUTH_SECRET);
      expect(config["serviceAccountKey"]).not.toContain("PRIVATE KEY");
      expect(decryptSecret(config["serviceAccountKey"])).toBe(PEM);

      const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: SEO_GOOGLE_SETTING, actorId: userId }, orderBy: { createdAt: "desc" } });
      const trail = JSON.stringify([audit.before, audit.after]);
      expect(trail).not.toContain(OAUTH_SECRET);
      expect(trail).not.toContain("PRIVATE KEY");
      expect(trail).not.toContain(config["oauthClientSecret"]);
    });

    it("blank keeps the stored secrets", async () => {
      const before = (await db.integrationSetting.findUniqueOrThrow({ where: { provider: SEO_GOOGLE_SETTING } })).config;
      await saveGoogleSettings(admin(), seoGoogleSettingsSchema.parse({ oauthClientId: OAUTH_ID }));
      expect((await db.integrationSetting.findUniqueOrThrow({ where: { provider: SEO_GOOGLE_SETTING } })).config).toEqual(before);
    });

    it("refuses a key file that is not one, naming the problem", async () => {
      await expect(saveGoogleSettings(admin(), seoGoogleSettingsSchema.parse({ oauthClientId: OAUTH_ID, serviceAccountJson: '{"type":"authorized_user"}' }))).rejects.toThrow(/not a service account key/);
    });

    it("tells viewers which methods exist, without any secret", async () => {
      expect(await googleMethodsAvailable(viewer())).toEqual({ oauth: true, serviceAccount: SA_EMAIL });
    });
  });

  // ---------------------------------------------------------------------------
  // Connecting
  // ---------------------------------------------------------------------------

  describe("connecting a property", () => {
    const sites = (list: { siteUrl: string; permissionLevel: string }[]) =>
      stubGoogle((url) => {
        if (url === "https://oauth2.googleapis.com/token") return json({ access_token: "ya29.sa", expires_in: 3600 });
        if (url === "https://www.googleapis.com/webmasters/v3/sites") return json({ siteEntry: list });
        return undefined;
      });

    it("only someone allowed to connect may, and never from the portal", async () => {
      await expect(connectGscWithServiceAccount(viewer(), propA)).rejects.toBeInstanceOf(ForbiddenError);
      const portal = actor(["seo.intelligence.view", "seo.intelligence.connect"], { type: "CLIENT", clientId: clientA });
      await expect(connectGscWithServiceAccount(portal, propA)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getGscConnection(portal, propA)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("with the service account: pending, then this website's site only", async () => {
      await resetConnection(propA);
      await connectGscWithServiceAccount(admin(), propA);
      expect(await getGscConnection(viewer(), propA)).toMatchObject({ method: "SERVICE_ACCOUNT", status: "PENDING", accountEmail: SA_EMAIL, siteUrl: null });

      sites([
        { siteUrl: "sc-domain:other.example.net", permissionLevel: "siteOwner" },
        { siteUrl: "sc-domain:site.example.org", permissionLevel: "siteRestrictedUser" },
        { siteUrl: "https://site.example.org/", permissionLevel: "siteUnverifiedUser" },
      ]);
      const options = await listGscSites(admin(), propA);
      expect(options[0]).toMatchObject({ siteUrl: "sc-domain:site.example.org", matches: true, usable: true });
      expect(options.find((o) => o.siteUrl === "sc-domain:other.example.net")).toMatchObject({ matches: false });

      // Another client's site, an unverified one, and one Google never listed are all refused.
      await expect(chooseGscSite(admin(), propA, "sc-domain:other.example.net")).rejects.toThrow(/not for site\.example\.org/);
      await expect(chooseGscSite(admin(), propA, "https://site.example.org/")).rejects.toThrow(/not verified/);
      await expect(chooseGscSite(admin(), propA, "sc-domain:invented.example.org")).rejects.toThrow(/not visible to this account/);
      await expect(chooseGscSite(admin(), propA, "sc-domain:invented.example.org")).rejects.toBeInstanceOf(ValidationError);
      // Reading Google's list and choosing are for people who may connect.
      await expect(listGscSites(viewer(), propA)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(chooseGscSite(viewer(), propA, "sc-domain:site.example.org")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(disconnectGsc(viewer(), propA)).rejects.toBeInstanceOf(ForbiddenError);
      expect((await db.seoProperty.findUniqueOrThrow({ where: { id: propA } })).gscSiteUrl).toBeNull();

      await chooseGscSite(admin(), propA, "sc-domain:site.example.org");
      expect(await getGscConnection(viewer(), propA)).toMatchObject({ status: "CONNECTED", siteUrl: "sc-domain:site.example.org", permissionLevel: "siteRestrictedUser" });
      const property = await db.seoProperty.findUniqueOrThrow({ where: { id: propA } });
      expect(property.gscSiteUrl).toBe("sc-domain:site.example.org");
      expect(property.verifiedAt).not.toBeNull();
    });

    it("a service account Google refuses surfaces as a credentials error", async () => {
      stubGoogle((url) => (url === "https://oauth2.googleapis.com/token" ? json({ error: "invalid_grant" }, 400) : undefined));
      await expect(listGscSites(admin(), propA)).rejects.toBeInstanceOf(SeoCredentialsError);
    });

    it("with Google sign-in: tokens stored encrypted, renewed when expiring", async () => {
      await resetConnection(propB);
      stubGoogle((url, init) => {
        if (url === "https://oauth2.googleapis.com/token") {
          const body = new URLSearchParams(String(init?.body));
          if (body.get("grant_type") === "authorization_code") {
            return json({ access_token: "ya29.first", refresh_token: "1//refresh", expires_in: 3600, scope: "https://www.googleapis.com/auth/webmasters.readonly openid email" });
          }
          if (body.get("grant_type") === "refresh_token") return json({ access_token: "ya29.second", expires_in: 3600 });
        }
        if (url === "https://openidconnect.googleapis.com/v1/userinfo") return json({ email: "owner@other.example.net" });
        if (url === "https://www.googleapis.com/webmasters/v3/sites") return json({ siteEntry: [{ siteUrl: "sc-domain:other.example.net", permissionLevel: "siteOwner" }] });
        return undefined;
      });

      await completeGscOAuth(admin(), propB, "auth-code");
      const stored = await db.seoConnection.findUniqueOrThrow({ where: { propertyId_source: { propertyId: propB, source: "SEARCH_CONSOLE" } } });
      expect(stored).toMatchObject({ method: "OAUTH", status: "PENDING", accountEmail: "owner@other.example.net" });
      expect(stored.accessToken).not.toContain("ya29");
      expect(decryptSecret(stored.refreshToken)).toBe("1//refresh");
      expect(JSON.stringify(await getGscConnection(viewer(), propB))).not.toContain("ya29");

      await db.seoConnection.update({ where: { id: stored.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
      await listGscSites(admin(), propB);
      const renewed = await db.seoConnection.findUniqueOrThrow({ where: { id: stored.id } });
      expect(decryptSecret(renewed.accessToken)).toBe("ya29.second");
      expect(decryptSecret(renewed.refreshToken)).toBe("1//refresh");
    });

    it("a revoked sign-in is a credentials error", async () => {
      const stored = await db.seoConnection.findUniqueOrThrow({ where: { propertyId_source: { propertyId: propB, source: "SEARCH_CONSOLE" } } });
      await db.seoConnection.update({ where: { id: stored.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
      stubGoogle((url) => (url === "https://oauth2.googleapis.com/token" ? json({ error: "invalid_grant" }, 400) : undefined));
      await expect(listGscSites(admin(), propB)).rejects.toBeInstanceOf(SeoCredentialsError);
    });

    it("disconnecting removes the credentials and keeps the history", async () => {
      await connected(propB);
      await db.gscDailyTotal.create({ data: { propertyId: propB, date: toDbDate("2026-09-01"), clicks: 3, impressions: 9, position: 4 } });
      stubGoogle((url) => (url === "https://oauth2.googleapis.com/revoke" ? json({}) : undefined));
      await disconnectGsc(admin(), propB);
      expect(await getGscConnection(viewer(), propB)).toBeNull();
      expect(await db.gscDailyTotal.count({ where: { propertyId: propB } })).toBe(1);
      expect((await db.seoProperty.findUniqueOrThrow({ where: { id: propB } })).gscSiteUrl).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Syncing
  // ---------------------------------------------------------------------------

  describe("syncing", () => {
    const now = new Date("2026-10-03T18:00:00Z");
    const end = addDays(todayIn(GSC_TIME_ZONE, now), -1);

    it("first run: the recent days and one month of history, every table filled", async () => {
      await connected(propA);
      const { provider } = fakeGsc();
      const outcome = await syncGscProperty(propA, { trigger: "MANUAL", provider, now });
      expect(outcome).toMatchObject({ status: "SUCCEEDED", daysWritten: 35, error: null });

      expect(await db.gscDailyTotal.count({ where: { propertyId: propA, device: "", country: "" } })).toBe(35);
      expect(await db.gscDailyTotal.count({ where: { propertyId: propA, device: "MOBILE" } })).toBe(35);
      expect(await db.gscDailyTotal.count({ where: { propertyId: propA, country: "ind" } })).toBe(35);
      expect(await db.gscQueryDaily.count({ where: { propertyId: propA } })).toBe(70);
      expect(await db.gscPageDaily.count({ where: { propertyId: propA } })).toBe(35);
      // Which page ranks for which query, one pair per day here.
      expect(await db.gscQueryPageDaily.count({ where: { propertyId: propA, query: "seo agency", page: "https://site.example.org/services" } })).toBe(35);

      const connection = await db.seoConnection.findUniqueOrThrow({ where: { propertyId_source: { propertyId: propA, source: "SEARCH_CONSOLE" } } });
      expect(connection.dataThrough?.toISOString().slice(0, 10)).toBe(end);
      expect(connection.backfilledFrom?.toISOString().slice(0, 10)).toBe(addDays(end, -34));
      expect(connection.syncLockedUntil).toBeNull();
      expect(connection.lastSyncError).toBeNull();
      expect(await db.seoSyncRun.findFirstOrThrow({ where: { propertyId: propA }, orderBy: { startedAt: "desc" } })).toMatchObject({ status: "SUCCEEDED", daysWritten: 35, trigger: "MANUAL" });
    });

    it("re-reading a day replaces it: revised numbers, never duplicates", async () => {
      const { provider } = fakeGsc({ clicks: (day) => (day === end ? 99 : 10) });
      await syncGscProperty(propA, { trigger: "SCHEDULED", provider, now });
      expect(await db.gscDailyTotal.count({ where: { propertyId: propA, device: "", country: "", date: toDbDate(end) } })).toBe(1);
      expect((await db.gscDailyTotal.findFirstOrThrow({ where: { propertyId: propA, device: "", country: "", date: toDbDate(end) } })).clicks).toBe(99);
      // The second run walked one month further back.
      expect(await db.gscDailyTotal.count({ where: { propertyId: propA, device: "", country: "" } })).toBe(65);
    });

    it("a day Google no longer reports is emptied, not left stale", async () => {
      const { provider } = fakeGsc({ clicks: (day) => (day === end ? 0 : 10) });
      const sparse: SearchConsoleProvider = {
        listSites: provider.listSites,
        query: async (input) => (await provider.query(input)).filter((row) => !(Array.isArray(row.keys) && row.keys[0] === end)),
      };
      await syncGscProperty(propA, { trigger: "SCHEDULED", provider: sparse, now });
      expect(await db.gscDailyTotal.count({ where: { propertyId: propA, date: toDbDate(end) } })).toBe(0);
    });

    it("drops what is older than Google keeps, and nothing newer", async () => {
      await connected(propA);
      const ancient = toDbDate(addDays(end, -600));
      const kept = toDbDate(addDays(end, -400));
      await db.gscDailyTotal.createMany({
        data: [
          { propertyId: propA, date: ancient, clicks: 1, impressions: 1, position: 1 },
          { propertyId: propA, date: kept, clicks: 1, impressions: 1, position: 1 },
        ],
      });
      await db.gscQueryDaily.create({ data: { propertyId: propA, date: ancient, query: "old", clicks: 1, impressions: 1, position: 1 } });
      await db.gscPageDaily.create({ data: { propertyId: propA, date: ancient, page: "https://site.example.org/old", clicks: 1, impressions: 1, position: 1 } });
      await syncGscProperty(propA, { trigger: "SCHEDULED", provider: fakeGsc().provider, now });
      expect(await db.gscDailyTotal.count({ where: { propertyId: propA, date: ancient } })).toBe(0);
      expect(await db.gscQueryDaily.count({ where: { propertyId: propA, date: ancient } })).toBe(0);
      expect(await db.gscPageDaily.count({ where: { propertyId: propA, date: ancient } })).toBe(0);
      expect(await db.gscDailyTotal.count({ where: { propertyId: propA, date: kept } })).toBe(1);
    });

    it("lost access marks the connection as needing a person, and keeps the cursor", async () => {
      await connected(propA);
      const { provider } = fakeGsc({ failAfterCalls: 0, error: new SeoAccessError("no access") });
      const outcome = await syncGscProperty(propA, { trigger: "SCHEDULED", provider, now });
      expect(outcome).toMatchObject({ status: "FAILED", daysWritten: 0, error: "no access" });
      const connection = await db.seoConnection.findUniqueOrThrow({ where: { propertyId_source: { propertyId: propA, source: "SEARCH_CONSOLE" } } });
      expect(connection).toMatchObject({ status: "ERROR", lastSyncError: "no access", failureCount: 1, syncLockedUntil: null, backfilledFrom: null });
    });

    it("a quota stop part-way keeps what was written, stays connected, and resumes the same month next time", async () => {
      await connected(propA);
      // Recent range: 3 range calls + 5 days × 3 detail calls = 18; then the backfill range fails.
      const { provider } = fakeGsc({ failAfterCalls: 18 });
      const outcome = await syncGscProperty(propA, { trigger: "SCHEDULED", provider, now });
      expect(outcome).toMatchObject({ status: "PARTIAL", daysWritten: 5 });
      const connection = await db.seoConnection.findUniqueOrThrow({ where: { propertyId_source: { propertyId: propA, source: "SEARCH_CONSOLE" } } });
      expect(connection.status).toBe("CONNECTED");
      expect(connection.failureCount).toBe(1);
      // Only the completed recent range counts as history.
      expect(connection.backfilledFrom?.toISOString().slice(0, 10)).toBe(addDays(end, -4));
    });

    it("never runs twice at once", async () => {
      await connected(propA);
      const slow: SearchConsoleProvider = {
        listSites: async () => [],
        query: async (input) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return fakeGsc().provider.query(input);
        },
      };
      const [one, two] = await Promise.all([
        syncGscProperty(propA, { trigger: "SCHEDULED", provider: slow, now }),
        syncGscProperty(propA, { trigger: "SCHEDULED", provider: slow, now }),
      ]);
      expect([one.status, two.status].sort()).toEqual(["SUCCEEDED", "skipped"]);
    });

    it("skips a connection that is not connected", async () => {
      await connected(propA, { status: "PENDING", externalId: null });
      expect(await syncGscProperty(propA, { trigger: "SCHEDULED", provider: fakeGsc().provider, now })).toMatchObject({ status: "skipped" });
    });

    it("the scheduler takes due properties and backs off failing ones", async () => {
      await connected(propA, { failureCount: 3, lastAttemptAt: new Date(now.getTime() - 10 * 60_000) });
      await connected(propB, { lastSyncedAt: new Date(now.getTime() - 60_000), backfilledFrom: toDbDate("2020-01-01") });
      // propA failed 10 minutes ago (backoff 60 min); propB is fresh and complete.
      expect(await syncDueGscProperties({ now })).toEqual({ synced: 0, failed: 0 });
      expect(await db.seoSyncRun.count({ where: { propertyId: { in: [propA, propB] } } })).toBe(0);
    });

    it("Sync now: permission, rate limit and an audit entry", async () => {
      await expect(syncGscNow(viewer(), propA)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(syncGscNow(admin(), "missing")).rejects.toBeInstanceOf(NotFoundError);
      await connected(propA, { status: "PENDING", externalId: null });
      await db.rateLimitWindow.deleteMany({ where: { key: `seo-sync:${propA}` } });
      // Not connected: refused with the reason, and still counted against the limit.
      await expect(syncGscNow(admin(), propA)).rejects.toThrow(/Not connected/);
      await expect(syncGscNow(admin(), propA)).rejects.toThrow(/Not connected/);
      await expect(syncGscNow(admin(), propA)).rejects.toThrow(/Not connected/);
      await expect(syncGscNow(admin(), propA)).rejects.toBeInstanceOf(RateLimitedError);
    });
  });

  // ---------------------------------------------------------------------------
  // Reading it back
  // ---------------------------------------------------------------------------

  describe("the overview", () => {
    const latest = "2026-09-30";

    async function seed(propertyId: string, clicksNow: number, clicksBefore: number) {
      await resetConnection(propertyId);
      const rows: { date: Date; clicks: number; impressions: number; position: number }[] = [];
      for (let i = 0; i < 56; i++) {
        const day = addDays(latest, -i);
        const current = i < 28;
        rows.push({ date: toDbDate(day), clicks: current ? clicksNow : clicksBefore, impressions: 1000, position: current ? 6 : 8 });
      }
      await db.gscDailyTotal.createMany({ data: rows.map((row) => ({ propertyId, ...row })) });
      await db.gscQueryDaily.createMany({
        data: rows.flatMap((row, i) => [
          { propertyId, date: row.date, query: "seo agency", clicks: row.clicks, impressions: 600, position: i < 28 ? 3 : 12 },
          { propertyId, date: row.date, query: "seo audit", clicks: 1, impressions: 400, position: 9 },
        ]),
      });
      await db.gscPageDaily.createMany({
        data: rows.map((row) => ({ propertyId, date: row.date, page: "https://site.example.org/", clicks: row.clicks, impressions: 1000, position: 6 })),
      });
    }

    it("has nothing to say before any data", async () => {
      await resetConnection(propA);
      expect(await getSEOOverview(viewer(), propA, "28d")).toEqual({ state: "no-data" });
    });

    it("reports exactly what was stored, compared with the previous period", async () => {
      await seed(propA, 50, 100);
      const overview = await getSEOOverview(viewer(), propA, "28d");
      if (overview.state !== "ready") throw new Error("expected data");
      expect(overview.dataThrough).toBe(latest);
      expect(overview.kpis.clicks).toEqual({ current: 1400, previous: 2800, change: -0.5 });
      expect(overview.kpis.impressions).toEqual({ current: 28_000, previous: 28_000, change: 0 });
      expect(overview.kpis.ctr.current).toBeCloseTo(0.05);
      expect(overview.kpis.position).toMatchObject({ current: 6, previous: 8, change: -2 });
      expect(overview.keywords.ranking.current).toBe(2);
      expect(overview.keywords.top3).toMatchObject({ current: 1, previous: 0 });
      expect(overview.keywords.top10).toMatchObject({ current: 2, previous: 1 });
      expect(overview.series).toHaveLength(28);
      expect(overview.series.at(-1)).toEqual({ date: latest, clicks: 50, impressions: 1000, previousClicks: 100 });
      expect(overview.topQueries[0]?.key).toBe("seo agency");
      const keys = overview.changes.map((change) => change.key);
      expect(keys).toContain("total-clicks");
      expect(keys).toContain("pages-losing");
      expect(keys).toContain("queries-entered-top10");
      expect(overview.changes[0]?.severity).toBe("high");
    });

    it("weights position by impressions across days", async () => {
      await resetConnection(propA);
      await db.gscDailyTotal.createMany({
        data: [
          { propertyId: propA, date: toDbDate(latest), clicks: 90, impressions: 900, position: 2 },
          { propertyId: propA, date: toDbDate(addDays(latest, -1)), clicks: 1, impressions: 100, position: 12 },
        ],
      });
      const overview = await getSEOOverview(viewer(), propA, "7d");
      if (overview.state !== "ready") throw new Error("expected data");
      expect(overview.kpis.position.current).toBeCloseTo(3);
      expect(overview.kpis.clicks.previous).toBeNull();
      expect(overview.changes).toEqual([]);
    });

    it("never mixes in another client's website", async () => {
      await seed(propA, 50, 100);
      await seed(propB, 7, 7);
      const a = await getSEOOverview(viewer(), propA, "28d");
      const b = await getSEOOverview(viewer(), propB, "28d");
      if (a.state !== "ready" || b.state !== "ready") throw new Error("expected data");
      expect(a.kpis.clicks.current).toBe(1400);
      expect(b.kpis.clicks.current).toBe(196);
    });

    it("hides a deleted client's website, and refuses the portal", async () => {
      await db.client.update({ where: { id: clientB }, data: { deletedAt: new Date() } });
      try {
        await expect(getSEOOverview(viewer(), propB, "28d")).rejects.toBeInstanceOf(NotFoundError);
      } finally {
        await db.client.update({ where: { id: clientB }, data: { deletedAt: null } });
      }
      await expect(getSEOOverview(actor(["seo.intelligence.view"], { type: "CLIENT", clientId: clientA }), propA, "28d")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getSEOOverview(actor([]), propA, "28d")).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("pages, sorts, searches and filters the performance table in the database", async () => {
      await seed(propA, 50, 100);
      const all = await listGscRows(viewer(), propA, { dimension: "query", period: "28d", sort: "clicks", page: 1, pageSize: 10 });
      if (all.state !== "ready") throw new Error("expected data");
      expect(all.total).toBe(2);
      expect(all.rows.map((row) => row.key)).toEqual(["seo agency", "seo audit"]);
      expect(all.rows[0]?.previous?.clicks).toBe(2800);

      const byPosition = await listGscRows(viewer(), propA, { dimension: "query", period: "28d", sort: "position", page: 1 });
      if (byPosition.state !== "ready") throw new Error("expected data");
      expect(byPosition.rows[0]?.key).toBe("seo agency");

      const searched = await listGscRows(viewer(), propA, { dimension: "query", period: "28d", sort: "clicks", page: 1, q: "aud" });
      expect(searched.state === "ready" && searched.rows.map((row) => row.key)).toEqual(["seo audit"]);
      // LIKE wildcards in the search are literal.
      const wildcard = await listGscRows(viewer(), propA, { dimension: "query", period: "28d", sort: "clicks", page: 1, q: "%" });
      expect(wildcard.state === "ready" && wildcard.total).toBe(0);

      const only = await listGscRows(viewer(), propA, { dimension: "query", period: "28d", sort: "clicks", page: 1, keys: ["seo audit"] });
      expect(only.state === "ready" && only.rows.map((row) => row.key)).toEqual(["seo audit"]);

      const second = await listGscRows(viewer(), propA, { dimension: "query", period: "28d", sort: "clicks", page: 2, pageSize: 10 });
      expect(second.state === "ready" && second.rows).toEqual([]);
    });
  });
});
