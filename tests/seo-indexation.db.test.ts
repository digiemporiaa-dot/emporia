import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { INSPECTIONS_PER_DAY } from "@/lib/seo-intel/providers/gsc";
import { SeoRateLimitError } from "@/lib/seo-intel/providers/errors";
import { indexationOverview, inspectDueUrls, inspectUrlNow, listIndexation } from "@/lib/services/seo-intel/indexation.service";
import type { UrlInspectionProvider } from "@/lib/seo-intel/providers/types";
import type { Actor } from "@/lib/actor/types";

/**
 * URL Inspection against the database with a scripted Google: the sample
 * stays within the daily budget, failures are recorded rather than dropped,
 * a rate limit stops the batch, and only crawled URLs can be inspected.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `ix${Date.now().toString(36)}`;
const HOST = `${TAG}.example.com`;
const url = (path: string) => `https://${HOST}${path}`;

describeDb("SEO indexation", () => {
  let staffId = "";
  let clientId = "";
  let propertyId = "";
  const asked: string[] = [];

  const staff = (permissions: string[]): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "ADMIN", roleId: "r", clientId: null, ip: null, userAgent: null, permissions: new Set(permissions) }) as Actor;
  const manager = () => staff(["seo.intelligence.view", "seo.intelligence.manage"]);

  const google: UrlInspectionProvider = {
    async inspect({ url: target, siteUrl }) {
      expect(siteUrl).toBe(`sc-domain:${HOST}`);
      asked.push(target);
      if (target.endsWith("/broken")) throw new Error("Search Console answered 500.");
      if (target.endsWith("/limited")) throw new SeoRateLimitError(60);
      if (target.endsWith("/missing-from-google")) return { indexStatusResult: { verdict: "NEUTRAL", coverageState: "URL is unknown to Google" } };
      if (target.endsWith("/noindexed")) return { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed" } };
      return { indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed", googleCanonical: target, userCanonical: target } };
    },
  };
  const provider = () => google;

  beforeAll(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } })).id;
    clientId = (await db.client.create({ data: { name: `Index ${TAG}`, slug: `index-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    propertyId = (await db.seoProperty.create({ data: { clientId, domain: HOST, displayName: "Index test", crawlFrequency: "MANUAL" }, select: { id: true } })).id;
    await db.seoConnection.create({
      data: { propertyId, source: "SEARCH_CONSOLE", method: "SERVICE_ACCOUNT", status: "CONNECTED", externalId: `sc-domain:${HOST}` },
    });
    await db.crawlRun.create({
      data: {
        propertyId,
        trigger: "MANUAL",
        status: "SUCCEEDED",
        startUrl: url("/"),
        maxPages: 500,
        finishedAt: new Date(),
        pages: {
          create: [
            { url: url("/"), depth: 0, source: "START", state: "FETCHED", statusCode: 200, contentType: "text/html", indexable: true, inSitemap: true },
            { url: url("/missing-from-google"), depth: 1, source: "LINK", state: "FETCHED", statusCode: 200, contentType: "text/html", indexable: true, inSitemap: true },
            { url: url("/noindexed"), depth: 1, source: "LINK", state: "FETCHED", statusCode: 200, contentType: "text/html", indexable: false, inSitemap: false },
            { url: url("/broken"), depth: 1, source: "LINK", state: "FETCHED", statusCode: 200, contentType: "text/html", indexable: true, inSitemap: true },
            { url: url("/limited"), depth: 2, source: "LINK", state: "FETCHED", statusCode: 200, contentType: "text/html", indexable: true, inSitemap: false },
            { url: url("/after-limit"), depth: 2, source: "LINK", state: "FETCHED", statusCode: 200, contentType: "text/html", indexable: true, inSitemap: false },
            { url: url("/redirect"), depth: 1, source: "LINK", state: "FETCHED", statusCode: 301, contentType: "text/html", indexable: false },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    if (!clientId) return;
    await db.seoProperty.deleteMany({ where: { clientId } });
    await db.client.delete({ where: { id: clientId } });
  });

  it("inspects sitemap URLs first, records failures, and stops on a rate limit", async () => {
    await inspectDueUrls({ provider, perRun: 20, limit: 50 });
    // Sitemap URLs first, then indexable pages; the redirect and the noindexed
    // non-sitemap page are not asked about; the batch stops at the rate limit.
    expect(asked.slice(0, 3).sort()).toEqual([url("/"), url("/broken"), url("/missing-from-google")].sort());
    expect(asked).toContain(url("/limited"));
    expect(asked).not.toContain(url("/after-limit"));
    expect(asked).not.toContain(url("/redirect"));
    expect(asked).not.toContain(url("/noindexed"));

    const broken = await db.urlInspection.findUniqueOrThrow({ where: { propertyId_url: { propertyId, url: url("/broken") } } });
    expect(broken.error).toMatch(/500/);
    expect(await db.urlInspection.count({ where: { propertyId, url: url("/limited") } })).toBe(0);
  });

  it("does not exceed the daily budget", async () => {
    const used = await db.urlInspection.count({ where: { propertyId } });
    await db.urlInspection.createMany({
      data: Array.from({ length: INSPECTIONS_PER_DAY - used }, (_, i) => ({ propertyId, url: url(`/filler-${i}`), verdict: "PASS" })),
    });
    asked.length = 0;
    await inspectDueUrls({ provider, perRun: 20, limit: 50 });
    expect(asked).toEqual([]);
    await db.urlInspection.deleteMany({ where: { propertyId, url: { startsWith: url("/filler-") } } });
  });

  it("inspects one crawled URL on demand, and only crawled URLs", async () => {
    await expect(inspectUrlNow(staff(["seo.intelligence.view"]), propertyId, url("/noindexed"), { provider })).rejects.toThrow(ForbiddenError);
    await expect(inspectUrlNow(manager(), propertyId, "https://elsewhere.example.org/", { provider })).rejects.toThrow(NotFoundError);
    const result = await inspectUrlNow(manager(), propertyId, url("/noindexed"), { provider });
    expect(result?.verdict).toBe("PASS");
  });

  it("summarises Google's view against the crawl", async () => {
    const overview = await indexationOverview(manager(), propertyId);
    expect(overview.connected).toBe(true);
    expect(overview.pages).toBe(6);
    expect(overview.buckets.indexed).toBe(2);
    expect(overview.buckets["unknown-to-google"]).toBe(1);
    expect(overview.buckets.error).toBe(1);
    expect(overview.buckets["not-inspected"]).toBe(2);
    expect(overview.inspected).toBe(4);
    expect(overview.conflicts["indexable-not-indexed"]).toBe(1);
    expect(overview.conflicts["not-indexable-but-indexed"]).toBe(1);

    const conflicts = await listIndexation(manager(), propertyId, { conflict: "indexable-not-indexed" });
    expect(conflicts.rows.map((row) => row.url)).toEqual([url("/missing-from-google")]);
    const pending = await listIndexation(manager(), propertyId, { bucket: "not-inspected" });
    expect(pending.total).toBe(2);
  });
});
