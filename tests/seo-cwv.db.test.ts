import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, IntegrationNotConfiguredError } from "@/lib/errors";
import { toDbDate } from "@/lib/seo-intel/dates";
import { SeoCredentialsError } from "@/lib/seo-intel/providers/errors";
import { cruxApiKey, SEO_GOOGLE_SETTING } from "@/lib/seo-intel/google/settings";
import { checkCwv, checkCwvNow, checkDueCwv, cwvOverview, CWV_TOP_PAGES } from "@/lib/services/seo-intel/cwv.service";
import { getGoogleSettings, saveGoogleSettings } from "@/lib/services/seo-intel/google-settings.service";
import { seoGoogleSettingsSchema } from "@/lib/validation/seo-intel";
import { cruxDouble } from "./support/crux-double";
import type { CruxRecord } from "@/lib/seo-intel/providers/crux";
import type { Actor } from "@/lib/actor/types";

/**
 * Core Web Vitals against the database (Phase 11): the API key is stored
 * encrypted and never shown, the weekly check reads the origin (whichever
 * www variant has data) and the top pages by clicks, fills the origin's
 * history on the first check only, records why a check failed, and does
 * nothing at all without a key.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `cw${Date.now().toString(36)}`;
const HOST = `${TAG}.example.com`;
const NOW = new Date("2025-03-10T06:00:00Z");

const rec = (periodEnd: string, lcp: number | null, inp: number | null = 150, cls: number | null = 0.05): CruxRecord => ({ periodEnd, lcp, inp, cls, fcp: 1000, ttfb: 500 });

describeDb("Core Web Vitals", () => {
  let staffId = "";
  let clientId = "";
  let propertyId = "";
  let quietPropertyId = "";
  let savedSetting: { config: unknown; isEnabled: boolean } | null = null;

  const staff = (permissions: string[]): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "MARKETING_MANAGER", roleId: null, clientId: null, ip: null, userAgent: "vitest", permissions: new Set(permissions) }) as Actor;
  const admin = () => staff(["seo.intelligence.view", "seo.intelligence.manage", "seo.intelligence.connect"]);

  beforeAll(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true } })).id;
    savedSetting = await db.integrationSetting.findUnique({ where: { provider: SEO_GOOGLE_SETTING }, select: { config: true, isEnabled: true } });
    clientId = (await db.client.create({ data: { name: `CWV ${TAG}`, slug: `cwv-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    // The property is on the bare domain; Google only has data for www.
    propertyId = (await db.seoProperty.create({ data: { clientId, domain: HOST, displayName: "Fast", crawlFrequency: "MANUAL" }, select: { id: true } })).id;
    quietPropertyId = (await db.seoProperty.create({ data: { clientId, domain: `quiet-${HOST}`, displayName: "Quiet", crawlFrequency: "MANUAL" }, select: { id: true } })).id;

    // Search Console pages: 25 on the site (most clicks first by number), one off-site, one with a fragment.
    const pages = [];
    for (let i = 1; i <= 25; i++) {
      pages.push({ propertyId, date: toDbDate("2025-03-05"), page: `https://www.${HOST}/p${i}`, clicks: 1000 - i, impressions: 5000, position: 3 });
      // An old day outside the 28 days, which would otherwise reorder them.
      pages.push({ propertyId, date: toDbDate("2025-01-01"), page: `https://www.${HOST}/p${i}`, clicks: i * 100, impressions: 5000, position: 3 });
    }
    pages.push({ propertyId, date: toDbDate("2025-03-05"), page: "https://elsewhere.example/top", clicks: 5000, impressions: 9000, position: 1 });
    await db.gscPageDaily.createMany({ data: pages });
  });

  afterAll(async () => {
    if (savedSetting) await db.integrationSetting.update({ where: { provider: SEO_GOOGLE_SETTING }, data: { config: savedSetting.config as object, isEnabled: savedSetting.isEnabled } });
    else await db.integrationSetting.deleteMany({ where: { provider: SEO_GOOGLE_SETTING } });
    if (!clientId) return;
    await db.seoProperty.deleteMany({ where: { clientId } });
    await db.client.delete({ where: { id: clientId } });
  });

  describe("the API key", () => {
    it("is stored encrypted, shown only as set, and removable", async () => {
      await db.integrationSetting.deleteMany({ where: { provider: SEO_GOOGLE_SETTING } });
      expect(await cruxApiKey()).toBeNull();
      expect((await getGoogleSettings(admin())).cruxKeyConfigured).toBe(false);

      const input = seoGoogleSettingsSchema.parse({ oauthClientId: "", cruxApiKey: "AIzaSyTestKey_abcdefghijklmnop" });
      const view = await saveGoogleSettings(admin(), input);
      expect(view).toMatchObject({ cruxKeyConfigured: true, cruxKeyUnreadable: false });
      expect(JSON.stringify(view)).not.toContain("AIzaSyTestKey");
      const stored = await db.integrationSetting.findUniqueOrThrow({ where: { provider: SEO_GOOGLE_SETTING } });
      expect(JSON.stringify(stored.config)).not.toContain("AIzaSyTestKey");
      expect(await cruxApiKey()).toBe("AIzaSyTestKey_abcdefghijklmnop");

      // Blank keeps it.
      await saveGoogleSettings(admin(), seoGoogleSettingsSchema.parse({ oauthClientId: "" }));
      expect(await cruxApiKey()).toBe("AIzaSyTestKey_abcdefghijklmnop");
      const audit = await db.auditLog.findFirstOrThrow({ where: { entityType: "IntegrationSetting", entityId: SEO_GOOGLE_SETTING }, orderBy: { createdAt: "desc" } });
      expect(JSON.stringify(audit)).not.toContain("AIzaSyTestKey");

      await saveGoogleSettings(admin(), seoGoogleSettingsSchema.parse({ oauthClientId: "", removeCruxKey: true }));
      expect(await cruxApiKey()).toBeNull();
    });

    it("refuses something that is not an API key, and needs the connect permission", async () => {
      expect(seoGoogleSettingsSchema.safeParse({ oauthClientId: "", cruxApiKey: "short" }).success).toBe(false);
      expect(seoGoogleSettingsSchema.safeParse({ oauthClientId: "", cruxApiKey: "has spaces in it which is wrong" }).success).toBe(false);
      await expect(saveGoogleSettings(staff(["seo.intelligence.manage"]), seoGoogleSettingsSchema.parse({ oauthClientId: "" }))).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe("without a key", () => {
    it("checks nothing and says it is not configured", async () => {
      expect(await checkDueCwv({ now: NOW })).toEqual({ checked: 0, failed: 0 });
      await expect(checkCwv(propertyId, { now: NOW })).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
      const overview = await cwvOverview(admin(), propertyId);
      expect(overview).toMatchObject({ configured: false, phone: null, desktop: null, pages: [] });
    });
  });

  describe("checking", () => {
    it("reads the www origin, fills its history once, and the top twenty on-site pages by recent clicks", async () => {
      const crux = cruxDouble();
      crux.set(`https://www.${HOST}`, "PHONE", rec("2025-03-08", 2300));
      crux.set(`https://www.${HOST}`, "DESKTOP", rec("2025-03-08", 1200));
      crux.setHistory(`https://www.${HOST}`, "PHONE", [rec("2025-02-22", 3100), rec("2025-03-01", 2800), rec("2025-03-08", 9999)]);
      crux.set(`https://www.${HOST}/p1`, "PHONE", rec("2025-03-08", 4500, 150, 0.05));
      crux.set(`https://www.${HOST}/p2`, "PHONE", rec("2025-03-08", 2000, 150, 0.05));
      crux.set(`https://www.${HOST}/p3`, "PHONE", rec("2025-03-08", 3000, 150, 0.05));

      const outcome = await checkCwv(propertyId, { provider: crux, now: NOW });
      expect(outcome).toEqual({ origin: true, pages: CWV_TOP_PAGES, pagesWithData: 3 });

      // Bare origin first, then www.
      expect(crux.calls.slice(0, 4).map((c) => c.key)).toEqual([`https://${HOST}`, `https://${HOST}`, `https://www.${HOST}`, `https://www.${HOST}`]);
      const asked = crux.calls.filter((c) => c.kind === "record" && c.key.includes("/p")).map((c) => c.key);
      expect(asked).toHaveLength(20);
      expect(asked[0]).toBe(`https://www.${HOST}/p1`);
      expect(asked).not.toContain(`https://www.${HOST}/p21`);
      expect(asked.every((url) => url.startsWith(`https://www.${HOST}/`))).toBe(true);
      expect(crux.calls.filter((c) => c.kind === "history")).toHaveLength(2);

      const overview = await cwvOverview(admin(), propertyId);
      expect(overview.configured).toBe(false); // the double stands in for the key here
      // The latest record wins over history for the same period.
      expect(overview.phone).toMatchObject({ periodEnd: "2025-03-08", lcp: 2300, verdict: "good" });
      expect(overview.desktop).toMatchObject({ lcp: 1200 });
      expect(overview.trend.map((t) => t.lcp)).toEqual([3100, 2800, 2300]);
      // Worst first.
      expect(overview.pages.map((p) => [p.url.split("/").pop(), p.verdict])).toEqual([
        ["p1", "poor"],
        ["p3", "needs-improvement"],
        ["p2", "good"],
      ]);
      const property = await db.seoProperty.findUniqueOrThrow({ where: { id: propertyId } });
      expect(property.cwvCheckedAt?.getTime()).toBe(NOW.getTime());
      expect(property.cwvError).toBeNull();
    });

    it("does not refetch history once there are snapshots, and lists only pages from the latest check", async () => {
      const crux = cruxDouble();
      crux.set(`https://www.${HOST}`, "PHONE", rec("2025-03-15", 2200));
      crux.set(`https://www.${HOST}/p2`, "PHONE", rec("2025-03-15", 2100));
      const later = new Date("2025-03-17T06:00:00Z");
      await checkCwv(propertyId, { provider: crux, now: later });
      expect(crux.calls.some((c) => c.kind === "history")).toBe(false);
      const overview = await cwvOverview(admin(), propertyId);
      expect(overview.pages.map((p) => p.url)).toEqual([`https://www.${HOST}/p2`]);
      expect(overview.trend.at(-1)).toMatchObject({ periodEnd: "2025-03-15", lcp: 2200 });
    });

    it("records why a check failed, waits for next week, and clears it when one works", async () => {
      const crux = cruxDouble();
      crux.failWith(new SeoCredentialsError("Google does not accept the Chrome UX Report API key. Check it in SEO settings."));
      const at = new Date("2025-03-25T06:00:00Z");
      await expect(checkCwv(propertyId, { provider: crux, now: at })).rejects.toBeInstanceOf(SeoCredentialsError);
      const failed = await db.seoProperty.findUniqueOrThrow({ where: { id: propertyId } });
      expect(failed.cwvError).toMatch(/does not accept/);
      expect(failed.cwvCheckedAt?.getTime()).toBe(at.getTime());

      crux.failWith(null);
      await checkCwv(propertyId, { provider: crux, now: new Date("2025-03-26T06:00:00Z") });
      expect((await db.seoProperty.findUniqueOrThrow({ where: { id: propertyId } })).cwvError).toBeNull();
    });

    it("stores nothing for a site Google has no data for, without calling it an error", async () => {
      const crux = cruxDouble();
      expect(await checkCwv(quietPropertyId, { provider: crux, now: NOW })).toEqual({ origin: false, pages: 0, pagesWithData: 0 });
      expect(crux.calls.some((c) => c.kind === "history")).toBe(false);
      expect(await db.cwvSnapshot.count({ where: { propertyId: quietPropertyId } })).toBe(0);
      expect((await db.seoProperty.findUniqueOrThrow({ where: { id: quietPropertyId } })).cwvError).toBeNull();
    });
  });

  describe("schedule and permissions", () => {
    it("checks websites due by a week, oldest first, each once", async () => {
      await db.seoProperty.update({ where: { id: propertyId }, data: { cwvCheckedAt: new Date("2025-03-01T00:00:00Z") } });
      await db.seoProperty.update({ where: { id: quietPropertyId }, data: { cwvCheckedAt: new Date("2025-03-09T00:00:00Z") } });
      const crux = cruxDouble();
      const now = new Date("2025-03-10T00:00:00Z");
      // Every other website in the test database is due too; give them the limit.
      const result = await checkDueCwv({ provider: crux, now, limit: 500 });
      expect(result.checked).toBeGreaterThan(0);
      expect((await db.seoProperty.findUniqueOrThrow({ where: { id: propertyId } })).cwvCheckedAt?.getTime()).toBe(now.getTime());
      // Checked a day ago: not due.
      expect((await db.seoProperty.findUniqueOrThrow({ where: { id: quietPropertyId } })).cwvCheckedAt?.toISOString()).toBe("2025-03-09T00:00:00.000Z");
      // Nothing is due again straight away.
      const again = cruxDouble();
      await checkDueCwv({ provider: again, now, limit: 500 });
      expect(again.calls.some((c) => c.key.includes(HOST))).toBe(false);
    });

    it("lets managers check now, at most once an hour, and keeps it from the portal", async () => {
      const crux = cruxDouble();
      const now = new Date("2025-03-10T00:30:00Z");
      await expect(checkCwvNow(staff(["seo.intelligence.view"]), propertyId, { provider: crux, now })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(checkCwvNow(admin(), propertyId, { provider: crux, now })).rejects.toBeInstanceOf(ConflictError);
      const outcome = await checkCwvNow(admin(), propertyId, { provider: crux, now: new Date("2025-03-10T01:01:00Z") });
      expect(outcome.origin).toBe(false);
      expect(await db.auditLog.count({ where: { entityType: "SeoProperty", entityId: propertyId, action: "UPDATE" } })).toBeGreaterThan(0);
      const portal = { ...admin(), type: "CLIENT", clientId } as Actor;
      await expect(cwvOverview(portal, propertyId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(checkCwvNow(portal, propertyId, { provider: crux, now: new Date("2025-03-11T00:00:00Z") })).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
