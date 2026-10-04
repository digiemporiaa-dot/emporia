import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { addDays, toDbDate } from "@/lib/seo-intel/dates";
import {
  addLocalCities,
  importLocalFromCms,
  localCoverage,
  localSetup,
  removeLocalCity,
  removeLocalService,
  saveLocalService,
  setLocalCityAliases,
  setLocalPage,
} from "@/lib/services/seo-intel/local.service";
import { computeNap } from "@/lib/services/seo-intel/nap.service";
import { internationalOverview } from "@/lib/services/seo-intel/international.service";
import { detectOpportunities } from "@/lib/services/seo-intel/opportunity.service";
import { saveThresholds } from "@/lib/services/seo-intel/thresholds.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Local and international SEO against the database: the service × city lists
 * and their scoping, coverage from a crawl and Search Console, the CMS import
 * for the agency's own website, NAP checks against the business profile, and
 * the detector's new sources — including when they must not count as run.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `lc${Date.now().toString(36)}`;
const HOST = `${TAG}.example.com`;
const U = (path: string) => `https://${HOST}${path}`;
const LATEST = "2026-09-30";

describeDb("Local SEO", () => {
  let staffId = "";
  let clientId = "";
  let otherClientId = "";
  let internalClientId = "";
  let propertyId = "";
  let otherPropertyId = "";
  let internalPropertyId = "";
  let delhi = "";
  let pune = "";
  let cmsServiceId = "";
  let cmsPageId = "";
  let runId = "";

  const actor = (permissions: string[], overrides: Partial<Actor> = {}): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "ADMIN", roleId: "r", clientId: null, ip: null, userAgent: null, permissions: new Set(permissions), ...overrides }) as Actor;
  const manager = () => actor(["seo.intelligence.view", "seo.intelligence.manage"]);
  const viewer = () => actor(["seo.intelligence.view"]);

  beforeAll(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true } })).id;
    const mk = (name: string, isInternal = false) =>
      db.client.create({ data: { name: `${name} ${TAG}`, slug: `${name.toLowerCase()}-${TAG}`, ownerId: staffId, isInternal }, select: { id: true } }).then((c) => c.id);
    clientId = await mk("Local");
    otherClientId = await mk("Other");
    internalClientId = await mk("Agency", true);
    propertyId = (await db.seoProperty.create({ data: { clientId, domain: HOST, displayName: "Local site", crawlFrequency: "MANUAL" }, select: { id: true } })).id;
    otherPropertyId = (await db.seoProperty.create({ data: { clientId: otherClientId, domain: `other-${HOST}`, displayName: "Other", crawlFrequency: "MANUAL" }, select: { id: true } })).id;
    internalPropertyId = (await db.seoProperty.create({ data: { clientId: internalClientId, domain: `agency-${HOST}`, displayName: "Agency", crawlFrequency: "MANUAL" }, select: { id: true } })).id;
    delhi = (await db.city.create({ data: { slug: `delhi-${TAG}`, name: `Delhi${TAG}`, state: "Delhi", country: "India" }, select: { id: true } })).id;
    pune = (await db.city.create({ data: { slug: `pune-${TAG}`, name: `Pune${TAG}`, state: "Maharashtra", country: "India" }, select: { id: true } })).id;
    cmsServiceId = (await db.service.create({ data: { slug: `seo-${TAG}`, name: `Seo${TAG} Services`, shortDescription: "x", status: "PUBLISHED" }, select: { id: true } })).id;
    cmsPageId = (await db.serviceCityPage.create({ data: { serviceId: cmsServiceId, cityId: pune, status: "DRAFT" }, select: { id: true } })).id;

    // Search Console: queries naming each city with "seo", and page figures.
    const totals = [];
    const queries = [];
    const pages = [];
    for (let i = 0; i < 28; i++) {
      const date = toDbDate(addDays(LATEST, -i));
      totals.push({ propertyId, date, clicks: 10, impressions: 500, position: 8 });
      queries.push({ propertyId, date, query: `seo delhi${TAG}`, clicks: 1, impressions: 10, position: 5 });
      queries.push({ propertyId, date, query: `seo company pune${TAG}`, clicks: 0, impressions: 4, position: 12 });
      queries.push({ propertyId, date, query: `ppc pune${TAG}`, clicks: 0, impressions: 1, position: 30 });
      pages.push({ propertyId, date, page: U(`/seo/delhi${TAG}/`), clicks: 2, impressions: 40, position: 4 });
    }
    // Country totals: India most, the UAE a real share.
    for (let i = 0; i < 28; i++) {
      const date = toDbDate(addDays(LATEST, -i));
      totals.push({ propertyId, date, country: "ind", clicks: 7, impressions: 300, position: 8 });
      totals.push({ propertyId, date, country: "are", clicks: 3, impressions: 150, position: 9 });
      totals.push({ propertyId, date, country: "zzz", clicks: 1, impressions: 10, position: 9 });
    }
    await db.gscDailyTotal.createMany({ data: totals });
    await db.gscQueryDaily.createMany({ data: queries });
    await db.gscPageDaily.createMany({ data: pages });

    const run = await db.crawlRun.create({
      data: {
        propertyId,
        trigger: "MANUAL",
        status: "SUCCEEDED",
        startUrl: U("/"),
        maxPages: 500,
        finishedAt: new Date(),
        pages: {
          create: [
            {
              url: U("/"), depth: 0, source: "START", state: "FETCHED", statusCode: 200, indexable: true, title: "Home",
              hreflang: [{ lang: "en-in", href: U("/") }, { lang: "en-gb", href: U("/uk/") }],
              localBusiness: [{ types: ["ProfessionalService"], name: "Local Co", telephone: "+91 99999 00000", address: { street: "1 Ring Road", locality: "Delhi", region: null, postalCode: "110001", country: "IN" }, hasGeo: false, hasHours: true, url: null }],
              phones: ["+91 98765 43210"],
            },
            { url: U("/uk/"), depth: 1, source: "LINK", state: "FETCHED", statusCode: 200, indexable: true, title: "UK", hreflang: [{ lang: "en-in", href: U("/") }, { lang: "en-gb", href: U("/uk/") }] },
            { url: U(`/seo/delhi${TAG}/`), depth: 1, source: "LINK", state: "FETCHED", statusCode: 200, indexable: true, title: "SEO in Delhi" },
            { url: U(`/ppc-pune${TAG}`), depth: 1, source: "LINK", state: "FETCHED", statusCode: 200, indexable: false, title: "PPC" },
          ],
        },
      },
      select: { id: true },
    });
    runId = run.id;
  });

  afterAll(async () => {
    if (!clientId) return;
    await db.seoOpportunity.deleteMany({ where: { propertyId: { in: [propertyId, internalPropertyId] } } });
    await db.seoProperty.deleteMany({ where: { id: { in: [propertyId, otherPropertyId, internalPropertyId] } } });
    await db.clientBusinessProfile.deleteMany({ where: { clientId } });
    await db.client.deleteMany({ where: { id: { in: [clientId, otherClientId, internalClientId] } } });
    await db.serviceCityPage.deleteMany({ where: { serviceId: cmsServiceId } });
    await db.service.deleteMany({ where: { id: cmsServiceId } });
    await db.city.deleteMany({ where: { id: { in: [delhi, pune] } } });
  });

  describe("lists", () => {
    it("needs manage to change and refuses the portal", async () => {
      await expect(saveLocalService(viewer(), propertyId, { id: null, name: "SEO", terms: "" })).rejects.toThrow(ForbiddenError);
      await expect(localSetup(actor(["seo.intelligence.view"], { type: "CLIENT", clientId }), propertyId)).rejects.toThrow(ForbiddenError);
      await expect(localSetup(viewer(), "nope")).rejects.toThrow(NotFoundError);
    });

    it("adds, edits and validates services; names are unique per website", async () => {
      const { id } = await saveLocalService(manager(), propertyId, { id: null, name: "SEO", terms: "SEO, search engine optimisation" });
      await saveLocalService(manager(), propertyId, { id: null, name: "PPC", terms: "ppc" });
      await expect(saveLocalService(manager(), propertyId, { id: null, name: "SEO", terms: "" })).rejects.toThrow(ConflictError);
      await expect(saveLocalService(manager(), propertyId, { id: null, name: "Bad", terms: "x" })).rejects.toThrow(ValidationError);
      await expect(saveLocalService(manager(), propertyId, { id: null, name: " ", terms: "" })).rejects.toThrow(ValidationError);
      // Another website's service cannot be edited through this one.
      await expect(saveLocalService(manager(), otherPropertyId, { id, name: "Hijack", terms: "" })).rejects.toThrow(NotFoundError);
      await saveLocalService(manager(), propertyId, { id, name: "SEO", terms: "seo" });
      const setup = await localSetup(viewer(), propertyId);
      expect(setup.services.map((s) => [s.name, s.terms])).toEqual([["PPC", ["ppc"]], ["SEO", ["seo"]]]);
      expect(await db.auditLog.count({ where: { entityType: "SeoLocalService", entityId: id } })).toBe(2);
    });

    it("adds cities once, with other names, and removes them with their chosen pages", async () => {
      expect(await addLocalCities(manager(), propertyId, [delhi, pune, delhi])).toEqual({ added: 2 });
      expect(await addLocalCities(manager(), propertyId, [delhi])).toEqual({ added: 0 });
      await expect(addLocalCities(manager(), propertyId, ["missing"])).rejects.toThrow(NotFoundError);
      const setup = await localSetup(viewer(), propertyId);
      const puneRow = setup.cities.find((c) => c.cityId === pune)!;
      await setLocalCityAliases(manager(), propertyId, puneRow.id, "Poona, poona");
      expect((await localSetup(viewer(), propertyId)).cities.find((c) => c.cityId === pune)?.aliases).toEqual(["poona"]);
      await expect(setLocalCityAliases(manager(), otherPropertyId, puneRow.id, "x1")).rejects.toThrow(NotFoundError);
    });
  });

  describe("coverage", () => {
    it("matches pages, counts demand and decides each cell", async () => {
      const coverage = await localCoverage(viewer(), propertyId, { perPage: 50 });
      expect(coverage.total).toBe(4);
      const cell = (service: string, city: string) => {
        const serviceId = coverage.services.find((s) => s.name === service)!.id;
        return coverage.list.rows.find((c) => c.cityId === city)!.cells.find((c) => c.serviceId === serviceId)!;
      };
      expect(cell("SEO", delhi)).toMatchObject({ status: "covered", page: { url: U(`/seo/delhi${TAG}/`), how: "url" }, demand: { impressions: 280, clicks: 28 }, performance: { clicks: 56, impressions: 1120 } });
      expect(cell("SEO", pune)).toMatchObject({ status: "gap", page: null, demand: { impressions: 112 } });
      expect(cell("PPC", pune)).toMatchObject({ status: "not-indexable", page: { url: U(`/ppc-pune${TAG}`) } });
      expect(cell("PPC", delhi).status).toBe("gap");
      expect(coverage.counts).toMatchObject({ covered: 1, gap: 2, "not-indexable": 1 });
      expect(coverage.gapDemand).toBe(112);
      const gaps = await localCoverage(viewer(), propertyId, { status: "gap" });
      expect(gaps.list.total).toBe(2);
    });

    it("a chosen page replaces the match, must be on the website, and goes with its city", async () => {
      const seo = (await localSetup(viewer(), propertyId)).services.find((s) => s.name === "SEO")!;
      await expect(setLocalPage(manager(), propertyId, { localServiceId: seo.id, cityId: pune, url: "https://elsewhere.example/x" })).rejects.toThrow(ValidationError);
      await expect(setLocalPage(manager(), propertyId, { localServiceId: seo.id, cityId: "not-a-city", url: "/x" })).rejects.toThrow(NotFoundError);
      await setLocalPage(manager(), propertyId, { localServiceId: seo.id, cityId: pune, url: "/pune-seo" });
      const chosen = await localCoverage(viewer(), propertyId, { cell: `${seo.id}:${pune}` });
      expect(chosen.selected).toMatchObject({ status: "not-crawled", page: { url: U("/pune-seo"), how: "chosen" }, serviceName: "SEO" });
      await setLocalPage(manager(), propertyId, { localServiceId: seo.id, cityId: pune, url: null });
      expect((await localCoverage(viewer(), propertyId, { cell: `${seo.id}:${pune}` })).selected?.status).toBe("gap");

      await setLocalPage(manager(), propertyId, { localServiceId: seo.id, cityId: pune, url: U("/pune-seo") });
      const puneRow = (await localSetup(viewer(), propertyId)).cities.find((c) => c.cityId === pune)!;
      await removeLocalCity(manager(), propertyId, puneRow.id);
      expect(await db.seoLocalPage.count({ where: { propertyId } })).toBe(0);
      await addLocalCities(manager(), propertyId, [pune]);
    });

    it("imports from the CMS only for the agency's own website, linking CMS pages", async () => {
      await expect(importLocalFromCms(manager(), propertyId)).rejects.toThrow(ForbiddenError);
      const first = await importLocalFromCms(manager(), internalPropertyId);
      expect(first.services).toBeGreaterThanOrEqual(1);
      const again = await importLocalFromCms(manager(), internalPropertyId);
      expect(again).toEqual({ services: 0, cities: 0, skipped: 0 });
      const setup = await localSetup(viewer(), internalPropertyId);
      const imported = setup.services.find((s) => s.cmsServiceId === cmsServiceId)!;
      expect(imported.terms).toEqual([`seo${TAG} services`, `seo${TAG}`]);
      expect(setup.cities.some((c) => c.cityId === pune)).toBe(true);
      const coverage = await localCoverage(viewer(), internalPropertyId, { cell: `${imported.id}:${pune}` });
      expect(coverage.selected).toMatchObject({ status: "draft", cms: { id: cmsPageId, status: "DRAFT" } });
      // An unpublished CMS page is not offered as the page: it is not on the website.
      expect(coverage.selected?.page).toBeNull();

      await db.serviceCityPage.update({ where: { id: cmsPageId }, data: { status: "PUBLISHED" } });
      const published = await localCoverage(viewer(), internalPropertyId, { cell: `${imported.id}:${pune}` });
      expect(published.selected).toMatchObject({ status: "not-crawled", page: { url: `https://agency-${HOST}/services/seo-${TAG}/pune-${TAG}`, how: "cms" } });
    });
  });

  describe("NAP", () => {
    it("needs a business profile, then compares the site and listings with it", async () => {
      expect((await computeNap(propertyId)).profileReady).toBe(false);
      await db.clientBusinessProfile.create({ data: { clientId, legalName: "Local Co Pvt Ltd", addressLine1: "1 Ring Road", city: "Delhi", postalCode: "110002", countryCode: "IN", publicPhone: "+91 98765 43210" } });
      const nap = await computeNap(propertyId);
      expect(nap.profileReady).toBe(true);
      expect(nap.truth.names).toEqual([`Local ${TAG}`, "Local Co Pvt Ltd"]);
      expect(nap.report?.schemaPages).toBe(1);
      expect(nap.report?.schemaMismatches[0]?.mismatches.map((m) => m.field)).toEqual(["phone", "postalCode"]);
      expect(nap.report?.phoneOnSite).toBe(true);
      expect(nap.report?.incomplete).toEqual([{ url: U("/"), entity: "Local Co", required: [], recommended: ["geo"] }]);
    });
  });

  describe("international", () => {
    it("lists versions, issues and countries; a multi-version site flags a country with no version", async () => {
      await db.crawlIssue.create({ data: { runId, rule: "hreflang-no-return", severity: "WARNING" } });
      const data = await internationalOverview(viewer(), propertyId);
      expect(data.versions).toEqual([{ code: "en-in", pages: 2 }, { code: "en-gb", pages: 2 }]);
      expect(data.multiVersion).toBe(true);
      expect(data.issues.find((i) => i.rule === "hreflang-no-return")?.count).toBe(1);
      expect(data.countries.map((c) => [c.country, c.clicks, c.hasVersion, c.missing])).toEqual([
        ["IN", 196, true, false],
        ["AE", 84, false, true],
      ]);
      await expect(internationalOverview(actor(["seo.intelligence.view"], { type: "CLIENT", clientId }), propertyId)).rejects.toThrow(ForbiddenError);
    });
  });

  describe("detection", () => {
    it("creates local, NAP and international findings; reviews do not run without a location", async () => {
      const result = await detectOpportunities(propertyId, new Date("2026-10-01T06:00:00Z"));
      expect(result.sources).toEqual(expect.arrayContaining(["LOCAL", "NAP", "INTERNATIONAL"]));
      expect(result.sources).not.toContain("REVIEWS");
      const rows = await db.seoOpportunity.findMany({ where: { propertyId }, select: { fingerprint: true, source: true, impact: true, severity: true, status: true } });
      const seo = (await localSetup(viewer(), propertyId)).services.find((s) => s.name === "SEO")!;
      const ppc = (await localSetup(viewer(), propertyId)).services.find((s) => s.name === "PPC")!;
      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ fingerprint: `local:gap:${seo.id}:${pune}`, source: "LOCAL", impact: 112, severity: "LOW" }),
        expect.objectContaining({ fingerprint: `local:not-indexable:${ppc.id}:${pune}`, source: "LOCAL" }),
        expect.objectContaining({ fingerprint: "nap:schema:phone", source: "NAP", impact: 1 }),
        expect.objectContaining({ fingerprint: "nap:schema:postalCode", source: "NAP" }),
        expect.objectContaining({ fingerprint: "international:country:AE", source: "INTERNATIONAL", impact: 84, severity: "HIGH" }),
      ]));
      // No search names PPC and Delhi together: a gap without demand is not worth a finding.
      expect(rows.some((row) => row.fingerprint === `local:gap:${ppc.id}:${delhi}`)).toBe(false);
    });

    it("a higher gap threshold resolves the gap; no Search Console data leaves it alone", async () => {
      const seo = (await localSetup(viewer(), propertyId)).services.find((s) => s.name === "SEO")!;
      const gap = `local:gap:${seo.id}:${pune}`;
      await saveThresholds(actor(["seo.intelligence.manage"]), propertyId, { "local.gapMinImpressions": 500 });
      await detectOpportunities(propertyId);
      expect((await db.seoOpportunity.findFirstOrThrow({ where: { propertyId, fingerprint: gap } })).status).toBe("RESOLVED");
      await saveThresholds(actor(["seo.intelligence.manage"]), propertyId, { "local.gapMinImpressions": null });
      await detectOpportunities(propertyId);
      expect((await db.seoOpportunity.findFirstOrThrow({ where: { propertyId, fingerprint: gap } })).status).toBe("OPEN");

      // Without Search Console data the coverage source does not run, so nothing it found is resolved.
      await db.gscDailyTotal.updateMany({ where: { propertyId }, data: { propertyId: otherPropertyId } });
      const result = await detectOpportunities(propertyId);
      expect(result.sources).not.toContain("LOCAL");
      expect(result.sources).not.toContain("INTERNATIONAL");
      expect((await db.seoOpportunity.findFirstOrThrow({ where: { propertyId, fingerprint: gap } })).status).toBe("OPEN");
      expect((await db.seoOpportunity.findFirstOrThrow({ where: { propertyId, fingerprint: "international:country:AE" } })).status).toBe("OPEN");
      await db.gscDailyTotal.updateMany({ where: { propertyId: otherPropertyId }, data: { propertyId } });
    });

    it("removing a service resolves its findings on the next run", async () => {
      const ppc = (await localSetup(viewer(), propertyId)).services.find((s) => s.name === "PPC")!;
      await removeLocalService(manager(), propertyId, ppc.id);
      await detectOpportunities(propertyId);
      expect((await db.seoOpportunity.findFirstOrThrow({ where: { propertyId, fingerprint: `local:not-indexable:${ppc.id}:${pune}` } })).status).toBe("RESOLVED");
    });
  });
});
