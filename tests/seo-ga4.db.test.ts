import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { chooseGa4Property, disconnectGa4, getGa4Connection, listGa4Properties } from "@/lib/services/seo-intel/ga4-connection.service";
import { syncDueGa4Properties, syncGa4Property } from "@/lib/services/seo-intel/ga4-sync.service";
import { addDays, eachDay, todayIn } from "@/lib/seo-intel/dates";
import { SeoAccessError } from "@/lib/seo-intel/providers/errors";
import type { AnalyticsProvider, Ga4ReportInput } from "@/lib/seo-intel/providers/ga4";
import type { Actor } from "@/lib/actor/types";

/**
 * GA4 against the database with an in-memory GA4: choosing a property (only
 * one these credentials see, whose web stream is this website), and the sync —
 * every table filled per day, history walked back a month per run, a day
 * re-read replaced not duplicated, failures recorded.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `ga${Date.now().toString(36)}`;
const HOST = `${TAG}.example.com`;

const metrics = (sessions: number, keyEvents: number, revenue: string) => [String(sessions), String(Math.round(sessions * 0.6)), String(keyEvents), revenue];

function fakeGa4(options: { streams?: string[]; fail?: Error } = {}) {
  const calls: Ga4ReportInput[] = [];
  const provider: AnalyticsProvider = {
    async listProperties() {
      return [
        { property: "properties/101", displayName: "Site", account: "accounts/1", accountName: "A" },
        { property: "properties/202", displayName: "Someone else", account: "accounts/1", accountName: "A" },
      ];
    },
    async getProperty(property) {
      return { property, displayName: "Site", currencyCode: "AED", timeZone: "Asia/Dubai" };
    },
    async listWebStreams(property) {
      return property === "properties/101" ? (options.streams ?? [`https://www.${HOST}/`]).map((defaultUri) => ({ defaultUri })) : [{ defaultUri: "https://elsewhere.example/" }];
    },
    async runReport(input) {
      calls.push(input);
      if (options.fail) throw options.fail;
      const days = eachDay(input.startDate, input.endDate).map((d) => d.replace(/-/g, ""));
      const dims = input.dimensions;
      const rows: string[][] = [];
      const key = dims.join(",");
      for (const day of days) {
        if (key === "date,sessionDefaultChannelGroup") rows.push([day, "Organic Search", ...metrics(100, 2, "500.25")], [day, "Direct", ...metrics(20, 1, "0")]);
        if (key === "date,countryId") rows.push([day, "IN", ...metrics(70, 1, "300.25")], [day, "AE", ...metrics(30, 1, "200")]);
        if (key === "date,deviceCategory") rows.push([day, "mobile", ...metrics(60, 1, "0")], [day, "desktop", ...metrics(40, 1, "500.25")]);
      }
      if (key === "landingPage,sessionDefaultChannelGroup") {
        rows.push(["/", "Organic Search", ...metrics(60, 0, "0")], ["/services/seo", "Organic Search", ...metrics(40, 2, "500.25")], ["/", "Direct", ...metrics(20, 1, "0")]);
      }
      return {
        dimensionHeaders: dims.map((name) => ({ name })),
        metricHeaders: ["sessions", "engagedSessions", "keyEvents", "totalRevenue"].map((name) => ({ name })),
        rows: rows.slice(input.offset ?? 0, (input.offset ?? 0) + input.limit).map((row) => ({
          dimensionValues: row.slice(0, dims.length).map((value) => ({ value })),
          metricValues: row.slice(dims.length).map((value) => ({ value })),
        })),
        rowCount: rows.length,
      };
    },
  };
  return { provider, calls };
}

describeDb("SEO GA4", () => {
  let staffId = "";
  let clientId = "";
  let propertyId = "";
  const now = new Date("2026-10-05T08:00:00Z");
  const yesterday = addDays(todayIn("Asia/Dubai", now), -1);

  const actor = (permissions: string[], overrides: Partial<Actor> = {}): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "ADMIN", roleId: "r", clientId: null, ip: null, userAgent: null, permissions: new Set(permissions), ...overrides }) as Actor;
  const admin = () => actor(["seo.intelligence.view", "seo.intelligence.manage", "seo.intelligence.connect"]);

  beforeAll(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true } })).id;
    clientId = (await db.client.create({ data: { name: `GA4 ${TAG}`, slug: `ga4-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    propertyId = (await db.seoProperty.create({ data: { clientId, domain: HOST, displayName: "GA4 site", crawlFrequency: "MANUAL" }, select: { id: true } })).id;
    await db.seoConnection.create({ data: { propertyId, source: "ANALYTICS", method: "SERVICE_ACCOUNT", status: "PENDING", accountEmail: "sa@x.iam.gserviceaccount.com", scopes: [] } });
  });

  afterAll(async () => {
    if (!clientId) return;
    await db.seoProperty.deleteMany({ where: { id: propertyId } });
    await db.client.deleteMany({ where: { id: clientId } });
  });

  describe("choosing a property", () => {
    it("needs the connect permission, and staff", async () => {
      const { provider } = fakeGa4();
      await expect(listGa4Properties(actor(["seo.intelligence.view"]), propertyId, { provider })).rejects.toThrow(ForbiddenError);
      await expect(chooseGa4Property(actor(["seo.intelligence.connect"], { type: "CLIENT", clientId }), propertyId, "properties/101", { provider })).rejects.toThrow(ForbiddenError);
      await expect(listGa4Properties(admin(), "missing", { provider })).rejects.toThrow(NotFoundError);
    });

    it("lists properties, this website's first", async () => {
      const { provider } = fakeGa4();
      const options = await listGa4Properties(admin(), propertyId, { provider });
      expect(options.map((o) => [o.property, o.matches])).toEqual([["properties/101", true], ["properties/202", false]]);
    });

    it("refuses a property not visible, a malformed id, or one for another website", async () => {
      const { provider } = fakeGa4();
      await expect(chooseGa4Property(admin(), propertyId, "properties/999", { provider })).rejects.toThrow(/not visible/);
      await expect(chooseGa4Property(admin(), propertyId, "999", { provider })).rejects.toThrow(ValidationError);
      await expect(chooseGa4Property(admin(), propertyId, "properties/202", { provider })).rejects.toThrow(new RegExp(`no web data stream for ${HOST}`));
      await expect(chooseGa4Property(admin(), propertyId, "properties/101", { provider: fakeGa4({ streams: [`https://${HOST}.evil.example/`] }).provider })).rejects.toThrow(/no web data stream/);
    });

    it("accepts this website's property, with its currency and time zone, and clears another property's rows", async () => {
      await db.ga4DailyTotal.create({ data: { propertyId, date: new Date("2025-01-01"), channel: "Direct", sessions: 1, engagedSessions: 1, keyEvents: 0, revenue: "0" } });
      await chooseGa4Property(admin(), propertyId, "properties/101", { provider: fakeGa4({ streams: [`https://${HOST}`] }).provider });
      expect(await db.seoProperty.findUniqueOrThrow({ where: { id: propertyId }, select: { ga4PropertyId: true, ga4Currency: true, ga4TimeZone: true } })).toEqual({
        ga4PropertyId: "properties/101",
        ga4Currency: "AED",
        ga4TimeZone: "Asia/Dubai",
      });
      expect(await getGa4Connection(admin(), propertyId)).toMatchObject({ status: "CONNECTED", ga4Property: "properties/101", accountEmail: "sa@x.iam.gserviceaccount.com" });
      expect(await db.ga4DailyTotal.count({ where: { propertyId } })).toBe(0);
      expect(await db.auditLog.count({ where: { entityType: "SeoProperty", entityId: propertyId } })).toBeGreaterThanOrEqual(1);
    });
  });

  describe("syncing", () => {
    it("first run: recent days and a month of history, every table filled", async () => {
      const { provider, calls } = fakeGa4();
      const outcome = await syncGa4Property(propertyId, { trigger: "MANUAL", provider, now });
      expect(outcome).toMatchObject({ status: "SUCCEEDED", daysWritten: 33 });
      // Three range reports per range (2 ranges), one landing report per day.
      expect(calls.length).toBe(6 + 33);
      expect(calls.find((c) => c.dimensions.join() === "date,countryId")?.filter).toEqual({ field: "sessionDefaultChannelGroup", value: "Organic Search" });
      const day = new Date(`${yesterday}T00:00:00Z`);
      const totals = await db.ga4DailyTotal.findMany({ where: { propertyId, date: day }, orderBy: [{ channel: "asc" }, { country: "asc" }, { device: "asc" }] });
      expect(totals.map((t) => [t.channel, t.country, t.device, t.sessions, t.revenue.toString()])).toEqual([
        ["Direct", "", "", 20, "0"],
        ["Organic Search", "", "", 100, "500.25"],
        ["Organic Search", "", "desktop", 40, "500.25"],
        ["Organic Search", "", "mobile", 60, "0"],
        ["Organic Search", "AE", "", 30, "200"],
        ["Organic Search", "IN", "", 70, "300.25"],
      ]);
      expect(await db.ga4LandingDaily.count({ where: { propertyId, date: day } })).toBe(3);
      const connection = await db.seoConnection.findUniqueOrThrow({ where: { propertyId_source: { propertyId, source: "ANALYTICS" } } });
      expect(connection.dataThrough?.toISOString().slice(0, 10)).toBe(yesterday);
      expect(connection.backfilledFrom?.toISOString().slice(0, 10)).toBe(addDays(yesterday, -32));
      expect(connection).toMatchObject({ lastSyncError: null, failureCount: 0, syncLockedUntil: null });
    });

    it("the next run re-reads recent days without duplicates and walks a month further back", async () => {
      const { provider } = fakeGa4();
      await syncGa4Property(propertyId, { trigger: "SCHEDULED", provider, now: new Date(now.getTime() + 60_000) });
      const day = new Date(`${yesterday}T00:00:00Z`);
      expect(await db.ga4LandingDaily.count({ where: { propertyId, date: day } })).toBe(3);
      expect(await db.ga4DailyTotal.count({ where: { propertyId, date: day } })).toBe(6);
      const connection = await db.seoConnection.findUniqueOrThrow({ where: { propertyId_source: { propertyId, source: "ANALYTICS" } } });
      expect(connection.backfilledFrom?.toISOString().slice(0, 10)).toBe(addDays(yesterday, -62));
    });

    it("a run already holding the lease is not doubled", async () => {
      await db.seoConnection.update({ where: { propertyId_source: { propertyId, source: "ANALYTICS" } }, data: { syncLockedUntil: new Date(now.getTime() + 600_000) } });
      expect(await syncGa4Property(propertyId, { trigger: "MANUAL", provider: fakeGa4().provider, now })).toMatchObject({ status: "skipped" });
      await db.seoConnection.update({ where: { propertyId_source: { propertyId, source: "ANALYTICS" } }, data: { syncLockedUntil: null } });
    });

    it("lost access marks the connection for a person and keeps the data", async () => {
      const before = await db.ga4DailyTotal.count({ where: { propertyId } });
      const outcome = await syncGa4Property(propertyId, { trigger: "MANUAL", provider: fakeGa4({ fail: new SeoAccessError("This Google account cannot read that Analytics property.") }).provider, now });
      expect(outcome).toMatchObject({ status: "FAILED", daysWritten: 0, error: "This Google account cannot read that Analytics property." });
      const connection = await db.seoConnection.findUniqueOrThrow({ where: { propertyId_source: { propertyId, source: "ANALYTICS" } } });
      expect(connection).toMatchObject({ status: "ERROR", failureCount: 1 });
      expect(await db.ga4DailyTotal.count({ where: { propertyId } })).toBe(before);
      // Not connected: the scheduler leaves it alone until someone reconnects.
      expect(await syncDueGa4Properties({ now, provider: fakeGa4().provider, limit: 50 })).toMatchObject({ synced: 0 });
    });

    it("the scheduler picks up a connected website whose history is still filling", async () => {
      await db.seoConnection.update({ where: { propertyId_source: { propertyId, source: "ANALYTICS" } }, data: { status: "CONNECTED", failureCount: 0 } });
      const result = await syncDueGa4Properties({ now: new Date(now.getTime() + 120_000), provider: fakeGa4().provider, limit: 50 });
      expect(result.synced).toBeGreaterThanOrEqual(1);
    });

    it("disconnecting removes the credentials and keeps the history", async () => {
      const rows = await db.ga4DailyTotal.count({ where: { propertyId } });
      await disconnectGa4(admin(), propertyId);
      expect(await getGa4Connection(admin(), propertyId)).toBeNull();
      expect((await db.seoProperty.findUniqueOrThrow({ where: { id: propertyId } })).ga4PropertyId).toBeNull();
      expect(await db.ga4DailyTotal.count({ where: { propertyId } })).toBe(rows);
    });
  });
});
