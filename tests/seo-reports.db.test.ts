import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { toDbDate } from "@/lib/seo-intel/dates";
import { buildReportData, draftDueReports, generateSeoReport, getSeoReport, listSeoReports, portalSeoReports, setSeoReportNotes, setSeoReportPublished } from "@/lib/services/seo-intel/seo-report.service";
import { computeHistory, siteHistory } from "@/lib/services/seo-intel/history.service";
import type { Actor, PortalActor } from "@/lib/actor/types";

/**
 * Monthly SEO reports and site history against the database (Phase 11): the
 * snapshot's figures come from stored rows only, a source that is not
 * connected is null rather than zeros, a report is regenerable only as a
 * draft, a client sees only their own websites' published reports, and the
 * scheduler drafts last month's report from the 3rd without touching one
 * that exists. Dates sit in 2023 so no other test's rows fall inside.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `rp${Date.now().toString(36)}`;
const HOST = `site-${TAG}.example.com`;
const MONTH = "2023-05";
const NOW = new Date("2023-06-10T06:00:00Z");
const DRAFT_AT = new Date("2023-06-03T01:00:00Z");

const day = (iso: string) => toDbDate(iso);
const range = (month: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${month}-${String(from + i).padStart(2, "0")}`);

describeDb("Monthly SEO reports and history", () => {
  let staffId = "";
  let clientA = "";
  let clientB = "";
  let propertyId = "";
  let emptyPropertyId = "";
  let portalUserId = "";
  let reportId = "";

  const staff = (permissions: string[]): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "MARKETING_MANAGER", roleId: null, clientId: null, ip: null, userAgent: "vitest", permissions: new Set(permissions) }) as Actor;
  const manager = () => staff(["seo.intelligence.view", "seo.intelligence.manage"]);
  const viewer = () => staff(["seo.intelligence.view"]);
  const portal = (clientId: string): PortalActor => ({
    userId: portalUserId,
    type: "CLIENT",
    name: "Client",
    email: "c@x.test",
    roleName: "CLIENT_USER",
    roleId: null,
    clientId,
    permissions: new Set(["seo.intelligence.view", "seo.intelligence.manage"]),
    ip: null,
    userAgent: "vitest",
  });

  beforeAll(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true } })).id;
    clientA = (await db.client.create({ data: { name: `Client A ${TAG}`, slug: `a-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    clientB = (await db.client.create({ data: { name: `Client B ${TAG}`, slug: `b-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    propertyId = (
      await db.seoProperty.create({
        data: { clientId: clientA, domain: HOST, displayName: "Main site", crawlFrequency: "MANUAL", gscSiteUrl: `sc-domain:${HOST}`, ga4PropertyId: "properties/9", ga4Currency: "INR" },
        select: { id: true },
      })
    ).id;
    // Client B's website has no Search Console and no GA4.
    emptyPropertyId = (await db.seoProperty.create({ data: { clientId: clientB, domain: `b-${HOST}`, displayName: "B site", crawlFrequency: "MANUAL" }, select: { id: true } })).id;
    const roleId = (await db.role.findFirstOrThrow({ where: { name: "CLIENT_USER" }, select: { id: true } })).id;
    portalUserId = (await db.user.create({ data: { email: `portal-${TAG}@x.test`, name: "Portal", type: "CLIENT", status: "ACTIVE", clientId: clientA, roleId }, select: { id: true } })).id;

    // Search Console, site totals. May has 20 of 31 days; clicks 10/day; position 4 then 8.
    await db.gscDailyTotal.createMany({
      data: [
        ...range(MONTH, 1, 20).map((d, i) => ({ propertyId, date: day(d), clicks: 10, impressions: 100, position: i < 10 ? 4 : 8 })),
        // A device breakdown row is never part of the site total.
        { propertyId, date: day("2023-05-01"), device: "MOBILE", clicks: 999, impressions: 999, position: 1 },
        ...range("2023-04", 1, 30).map((d) => ({ propertyId, date: day(d), clicks: 5, impressions: 100, position: 10 })),
        ...range("2022-05", 1, 31).map((d) => ({ propertyId, date: day(d), clicks: 2, impressions: 50, position: 20 })),
      ],
    });
    await db.gscQueryDaily.createMany({
      data: [
        { propertyId, date: day("2023-05-10"), query: "seo agency", clicks: 50, impressions: 500, position: 3 },
        { propertyId, date: day("2023-05-10"), query: "seo company", clicks: 20, impressions: 200, position: 9 },
        { propertyId, date: day("2023-04-10"), query: "seo agency", clicks: 30, impressions: 300, position: 5 },
        { propertyId, date: day("2023-04-10"), query: "seo company", clicks: 10, impressions: 100, position: 7.5 },
      ],
    });
    await db.gscPageDaily.createMany({
      data: [
        { propertyId, date: day("2023-05-10"), page: `https://${HOST}/services/`, clicks: 40, impressions: 400, position: 4 },
        { propertyId, date: day("2023-04-10"), page: `https://${HOST}/services/`, clicks: 25, impressions: 300, position: 6 },
      ],
    });
    await db.seoKeyword.createMany({
      data: ["seo agency", "seo company", "local seo"].map((keyword) => ({ propertyId, keyword })),
    });

    // GA4: organic only, site totals only.
    await db.ga4DailyTotal.createMany({
      data: [
        { propertyId, date: day("2023-05-02"), channel: "Organic Search", sessions: 100, engagedSessions: 60, keyEvents: 2, revenue: "10.25" },
        { propertyId, date: day("2023-05-03"), channel: "Organic Search", sessions: 100, engagedSessions: 60, keyEvents: 2, revenue: "10.25" },
        { propertyId, date: day("2023-05-03"), channel: "Direct", sessions: 500, engagedSessions: 100, keyEvents: 9, revenue: "99" },
        { propertyId, date: day("2023-05-03"), channel: "Organic Search", country: "IN", sessions: 70, engagedSessions: 40, keyEvents: 1, revenue: "5" },
        { propertyId, date: day("2023-04-02"), channel: "Organic Search", sessions: 50, engagedSessions: 20, keyEvents: 1, revenue: "5" },
      ],
    });

    // Crawls: April's, May's, and one in June that a May report must not see.
    await db.seoCrawlHistory.createMany({
      data: [
        { propertyId, runId: `${TAG}-1`, finishedAt: new Date("2023-04-20T10:00:00Z"), pagesFetched: 90, indexablePages: 80, critical: 5, warning: 10, notice: 3 },
        { propertyId, runId: `${TAG}-2`, finishedAt: new Date("2023-05-25T10:00:00Z"), pagesFetched: 100, indexablePages: 92, critical: 2, warning: 7, notice: 4 },
        { propertyId, runId: `${TAG}-3`, finishedAt: new Date("2023-06-05T10:00:00Z"), pagesFetched: 101, indexablePages: 95, critical: 0, warning: 1, notice: 1 },
      ],
    });

    const opp = (fingerprint: string, data: Record<string, unknown>) => ({
      propertyId,
      fingerprint: `${TAG}:${fingerprint}`,
      source: "TECHNICAL" as const,
      type: "technical:x",
      title: `Fix ${fingerprint}`,
      evidence: {},
      impact: 1,
      severity: "LOW" as const,
      effort: "LOW" as const,
      ...data,
    });
    await db.seoOpportunity.createMany({
      data: [
        opp("new-open", { firstSeenAt: new Date("2023-05-05T00:00:00Z"), severity: "MEDIUM", impact: 5 }),
        opp("new-done", { firstSeenAt: new Date("2023-05-06T00:00:00Z"), status: "DONE", resolvedAt: new Date("2023-05-15T00:00:00Z") }),
        opp("old-resolved", { firstSeenAt: new Date("2023-04-01T00:00:00Z"), status: "RESOLVED", resolvedAt: new Date("2023-05-20T00:00:00Z") }),
        opp("old-high", { firstSeenAt: new Date("2023-04-01T00:00:00Z"), severity: "HIGH", impact: 1 }),
        opp("june-done", { firstSeenAt: new Date("2023-04-01T00:00:00Z"), status: "DONE", resolvedAt: new Date("2023-06-02T00:00:00Z") }),
      ],
    });
    await db.seoChangeEvent.createMany({
      data: [
        { propertyId, key: "clicks", periodEnd: day("2023-05-15"), severity: "HIGH", direction: "down", title: "Clicks fell 40%", entityType: "site", range: {} },
        { propertyId, key: "clicks", periodEnd: day("2023-06-02"), severity: "HIGH", direction: "up", title: "Clicks recovered", entityType: "site", range: {} },
      ],
    });
    await db.cwvSnapshot.createMany({
      data: [
        { propertyId, url: "", formFactor: "PHONE", periodEnd: day("2023-05-28"), lcp: 2100, inp: 180, cls: 0.05 },
        { propertyId, url: "", formFactor: "PHONE", periodEnd: day("2023-06-04"), lcp: 4000, inp: 500, cls: 0.4 },
        { propertyId, url: "", formFactor: "DESKTOP", periodEnd: day("2023-05-28"), lcp: 900, inp: 50, cls: 0 },
      ],
    });
  });

  afterAll(async () => {
    if (!clientA) return;
    await db.emailLog.deleteMany({ where: { entityType: "SeoReport", to: `portal-${TAG}@x.test` } });
    // The scheduler's drafts for other tests' websites, made at this test's moment.
    await db.seoReport.deleteMany({ where: { month: MONTH, generatedById: null, generatedAt: DRAFT_AT } });
    await db.seoProperty.deleteMany({ where: { id: { in: [propertyId, emptyPropertyId] } } });
    await db.user.deleteMany({ where: { id: portalUserId } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  describe("the snapshot", () => {
    it("adds up Search Console site totals for the month, the month before and a year ago", async () => {
      const data = await buildReportData(propertyId, MONTH, NOW);
      const s = data.search!;
      expect(s.current).toEqual({ clicks: 200, impressions: 2000, ctr: 0.1, position: 6, days: 20 });
      expect(s.previous).toMatchObject({ clicks: 150, impressions: 3000, position: 10, days: 30 });
      expect(s.lastYear).toMatchObject({ clicks: 62, impressions: 1550, position: 20, days: 31 });
      expect(s.daysInMonth).toBe(31);
      expect(s.topQueries).toEqual([
        { query: "seo agency", clicks: 50, impressions: 500, position: 3, previousClicks: 30 },
        { query: "seo company", clicks: 20, impressions: 200, position: 9, previousClicks: 10 },
      ]);
      // Pages are shown as paths, compared with the same page the month before.
      expect(s.topPages).toEqual([{ page: "/services", clicks: 40, impressions: 400, previousClicks: 25 }]);
    });

    it("moves tracked keywords by a full place or more, and counts first-page keywords", async () => {
      const { keywords } = await buildReportData(propertyId, MONTH, NOW);
      expect(keywords).toEqual({
        tracked: 3,
        inTop10: 2,
        improved: [{ keyword: "seo agency", from: 5, to: 3 }],
        declined: [{ keyword: "seo company", from: 7.5, to: 9 }],
      });
    });

    it("takes GA4 organic site totals only, revenue as money", async () => {
      const { organic } = await buildReportData(propertyId, MONTH, NOW);
      expect(organic).toEqual({
        current: { sessions: 200, engagedSessions: 120, keyEvents: 4, revenue: "20.50", days: 2 },
        previous: { sessions: 50, engagedSessions: 20, keyEvents: 1, revenue: "5.00", days: 1 },
        currency: "INR",
      });
    });

    it("uses the latest crawl finished by the month's end, against the one before", async () => {
      const { technical } = await buildReportData(propertyId, MONTH, NOW);
      expect(technical?.latest).toMatchObject({ pagesFetched: 100, critical: 2, warning: 7, finishedAt: "2023-05-25T10:00:00.000Z" });
      expect(technical?.previous).toMatchObject({ pagesFetched: 90, critical: 5 });
    });

    it("counts the month's opportunity work and lists what is open, worst first", async () => {
      const { opportunities } = await buildReportData(propertyId, MONTH, NOW);
      expect(opportunities).toMatchObject({ opened: 2, done: 1, resolved: 1, openNow: 2 });
      expect(opportunities.top.map((o) => o.severity)).toEqual(["HIGH", "MEDIUM"]);
    });

    it("takes the phone origin's Core Web Vitals and the month's changes, nothing after", async () => {
      const data = await buildReportData(propertyId, MONTH, NOW);
      expect(data.cwv).toEqual({ periodEnd: "2023-05-28", formFactor: "PHONE", lcp: 2100, inp: 180, cls: 0.05 });
      expect(data.changes).toEqual([{ title: "Clicks fell 40%", severity: "HIGH", periodEnd: "2023-05-15" }]);
      expect(data.reviews).toBeNull();
    });

    it("leaves sources that are not connected null, never zeros", async () => {
      const data = await buildReportData(emptyPropertyId, MONTH, NOW);
      expect(data.search).toBeNull();
      expect(data.keywords).toBeNull();
      expect(data.organic).toBeNull();
      expect(data.technical).toBeNull();
      expect(data.cwv).toBeNull();
      expect(data.website).toEqual({ name: "B site", domain: `b-${HOST}`, client: `Client B ${TAG}` });
    });
  });

  describe("drafting, notes and publishing", () => {
    it("drafts last month's report from the 3rd, only for websites with a source, and never twice", async () => {
      expect(await draftDueReports({ now: new Date("2023-06-02T23:00:00Z"), limit: 500 })).toBe(0);
      expect(await db.seoReport.count({ where: { propertyId } })).toBe(0);

      await draftDueReports({ now: DRAFT_AT, limit: 500 });
      const draft = await db.seoReport.findUniqueOrThrow({ where: { propertyId_month: { propertyId, month: MONTH } } });
      expect(draft).toMatchObject({ status: "DRAFT", generatedById: null });
      expect(await db.seoReport.count({ where: { propertyId: emptyPropertyId } })).toBe(0);
      reportId = draft.id;

      await db.seoReport.update({ where: { id: reportId }, data: { notes: "kept" } });
      await draftDueReports({ now: new Date("2023-06-04T01:00:00Z"), limit: 500 });
      const again = await db.seoReport.findUniqueOrThrow({ where: { id: reportId } });
      expect(again.generatedAt.getTime()).toBe(DRAFT_AT.getTime());
      expect(again.notes).toBe("kept");
    });

    it("needs the manage permission and a completed month, and never lets a client generate", async () => {
      await expect(generateSeoReport(viewer(), { propertyId, month: MONTH }, NOW)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(generateSeoReport(portal(clientA), { propertyId, month: MONTH }, NOW)).rejects.toBeInstanceOf(NotFoundError);
      await expect(generateSeoReport(manager(), { propertyId, month: "2023-06" }, NOW)).rejects.toBeInstanceOf(ValidationError);
      await expect(generateSeoReport(manager(), { propertyId, month: "2022-04" }, NOW)).rejects.toBeInstanceOf(ValidationError);
      await expect(generateSeoReport(manager(), { propertyId: "missing", month: MONTH }, NOW)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("regenerates a draft in place, keeping its notes, and audits it", async () => {
      const result = await generateSeoReport(manager(), { propertyId, month: MONTH }, NOW);
      expect(result.id).toBe(reportId);
      const row = await db.seoReport.findUniqueOrThrow({ where: { id: reportId } });
      expect(row).toMatchObject({ generatedById: staffId, notes: "kept", status: "DRAFT" });
      expect(row.generatedAt.getTime()).toBe(NOW.getTime());
      expect(await db.auditLog.count({ where: { entityType: "SeoReport", entityId: reportId, action: "UPDATE" } })).toBeGreaterThan(0);
    });

    it("keeps drafts from the client and publishes to their portal users only", async () => {
      await expect(getSeoReport(portal(clientA), reportId)).rejects.toBeInstanceOf(NotFoundError);
      expect(await portalSeoReports(portal(clientA))).toEqual([]);

      await setSeoReportNotes(manager(), reportId, "  A strong month for the services page.  ");
      await setSeoReportPublished(manager(), reportId, true);

      const seen = await getSeoReport(portal(clientA), reportId);
      expect(seen.notes).toBe("A strong month for the services page.");
      expect(seen.data.search?.current.clicks).toBe(200);
      expect((await portalSeoReports(portal(clientA))).map((r) => r.id)).toEqual([reportId]);
      await expect(getSeoReport(portal(clientB), reportId)).rejects.toBeInstanceOf(NotFoundError);
      expect(await portalSeoReports(portal(clientB))).toEqual([]);

      const emails = await db.emailLog.findMany({ where: { entityType: "SeoReport", entityId: reportId }, select: { to: true } });
      expect(emails.map((e) => e.to)).toEqual([`portal-${TAG}@x.test`]);
    });

    it("freezes a published report until it is unpublished", async () => {
      await expect(generateSeoReport(manager(), { propertyId, month: MONTH }, NOW)).rejects.toBeInstanceOf(ConflictError);
      await expect(setSeoReportNotes(manager(), reportId, "Edited")).rejects.toBeInstanceOf(ConflictError);
      await expect(setSeoReportPublished(manager(), reportId, true)).rejects.toBeInstanceOf(ConflictError);
      await expect(setSeoReportPublished(viewer(), reportId, false)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setSeoReportPublished(portal(clientA), reportId, false)).rejects.toBeInstanceOf(NotFoundError);

      await setSeoReportPublished(manager(), reportId, false);
      await expect(getSeoReport(portal(clientA), reportId)).rejects.toBeInstanceOf(NotFoundError);
      const row = await db.seoReport.findUniqueOrThrow({ where: { id: reportId } });
      expect(row).toMatchObject({ status: "DRAFT", publishedAt: null, publishedById: null });

      await setSeoReportNotes(manager(), reportId, "   ");
      expect((await db.seoReport.findUniqueOrThrow({ where: { id: reportId } })).notes).toBeNull();
      expect(await db.auditLog.count({ where: { entityType: "SeoReport", entityId: reportId, action: "STATUS_CHANGE" } })).toBe(2);
    });

    it("lists reports for staff with the view permission only", async () => {
      expect((await listSeoReports(viewer(), propertyId)).map((r) => r.month)).toEqual([MONTH]);
      await expect(listSeoReports(staff([]), propertyId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listSeoReports(portal(clientA), propertyId)).rejects.toBeInstanceOf(NotFoundError);
      await expect(getSeoReport(staff([]), reportId)).rejects.toBeInstanceOf(ForbiddenError);
      expect((await getSeoReport(viewer(), reportId)).status).toBe("DRAFT");
    });

    it("cannot read a report whose stored data no longer matches the schema", async () => {
      const broken = await db.seoReport.create({ data: { propertyId, month: "2023-01", data: { version: 99 }, status: "PUBLISHED" }, select: { id: true } });
      await expect(getSeoReport(viewer(), broken.id)).rejects.toBeInstanceOf(NotFoundError);
      await db.seoReport.delete({ where: { id: broken.id } });
    });
  });

  describe("history", () => {
    it("puts months on a sixteen-month axis anchored to the latest data, with gaps as null", async () => {
      const history = await computeHistory(propertyId, NOW);
      expect(history.months).toHaveLength(16);
      // GA4 and Search Console both end in May 2023.
      expect(history.months.at(-1)).toBe("2023-05");
      const may = history.search.at(-1);
      expect(may).toMatchObject({ month: "2023-05", clicks: 200, impressions: 2000, position: 6, days: 20, daysInMonth: 31 });
      expect(history.search.at(-2)).toMatchObject({ month: "2023-04", clicks: 150 });
      // The axis runs February 2022 – May 2023; a year-old month is on it, a month with no rows is null.
      expect(history.months[0]).toBe("2022-02");
      expect(history.search[history.months.indexOf("2022-05")]).toMatchObject({ clicks: 62, days: 31 });
      expect(history.search.at(-3)).toBeNull();
      expect(history.organic.at(-3)).toBeNull();
      expect(history.organic.at(-1)).toMatchObject({ sessions: 200, revenue: "20.50" });
      expect(history.hasSearch && history.hasAnalytics).toBe(true);
      expect(history.currency).toBe("INR");
    });

    it("lists crawls oldest first and the change timeline newest first", async () => {
      const history = await computeHistory(propertyId, NOW);
      expect(history.crawls.map((c) => c.runId)).toEqual([`${TAG}-1`, `${TAG}-2`, `${TAG}-3`]);
      expect(history.changes.map((c) => c.periodEnd)).toEqual(["2023-06-02", "2023-05-15"]);
      expect(history.flow).toHaveLength(12);
      // 2 June is in the week of 29 May, inside the twelve weeks to 10 June.
      expect(history.flow.find((w) => w.week === "2023-05-29")?.done).toBe(1);
    });

    it("is for staff with the view permission only", async () => {
      await expect(siteHistory(staff([]), propertyId)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(siteHistory(portal(clientA), propertyId)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});
