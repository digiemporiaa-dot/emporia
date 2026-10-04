import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { addDays, toDbDate } from "@/lib/seo-intel/dates";
import { advanceCrawls, cancelCrawl, startCrawl } from "@/lib/services/seo-intel/crawl.service";
import { contentFindings } from "@/lib/services/seo-intel/content.service";
import { linkExtremes, listLinkSuggestions } from "@/lib/services/seo-intel/links.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Phase 5 against the database: link suggestions made when a real crawl of a
 * local site finishes, the page text cleared afterwards, and content findings
 * from seeded Search Console rows.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `ct${Date.now().toString(36)}`;
const HOST = `${TAG}.example.com`;
const U = (path: string) => `http://${HOST}${path}`;

const html = (title: string, body: string, head = "") => `<!doctype html><html lang="en"><head><title>${title}</title>${head}</head><body>${body}</body></html>`;
const filler = Array.from({ length: 220 }, (_, i) => `w${i}`).join(" ");
const SITE: Record<string, string> = {
  "/": html("Home", `<h1>Home</h1><p>${filler}</p><a href="/services/seo">SEO</a><a href="/blog/a">A</a><a href="/blog/b">B</a><a href="/blog/c">C</a>`),
  "/services/seo": html("SEO services", `<h1>SEO</h1><p>${filler}</p><a href="/">Home</a>`),
  "/blog/a": html("Post A", `<h1>A</h1><p>Picking an SEO agency Dubai businesses trust takes care. ${filler}</p><a href="/">Home</a>`),
  "/blog/b": html("Post B", `<h1>B</h1><p>Our seo agency dubai guide. ${filler}</p><a href="/services/seo">already linked</a>`),
  "/blog/c": html("Post C", `<h1>C</h1><p>seo agency dubai again. ${filler}</p>`, `<meta name="robots" content="noindex">`),
};

describeDb("SEO content and internal links", () => {
  let server: Server;
  let port = 0;
  let staffId = "";
  let clientId = "";
  let propertyId = "";
  let bareId = "";
  const latest = "2026-09-30";

  const staff = (permissions: string[], overrides: Partial<Actor> = {}): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "ADMIN", roleId: "r", clientId: null, ip: null, userAgent: null, permissions: new Set(permissions), ...overrides }) as Actor;
  const manager = () => staff(["seo.intelligence.view", "seo.intelligence.manage"]);
  const work = () => ({ fetch: { resolve: async () => ["127.0.0.1"], port }, budgetMs: 20_000 });
  async function crawl(id: string) {
    await startCrawl(manager(), id);
    for (let i = 0; i < 20; i++) {
      await advanceCrawls(work());
      if ((await db.crawlRun.count({ where: { propertyId: id, status: "RUNNING" } })) === 0) return;
    }
    throw new Error("crawl did not finish");
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      const body = SITE[(req.url ?? "/").split("?")[0] as string];
      res.writeHead(body ? 200 : 404, { "content-type": "text/html" });
      res.end(body ?? "not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;

    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } })).id;
    clientId = (await db.client.create({ data: { name: `Content ${TAG}`, slug: `content-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    propertyId = (await db.seoProperty.create({ data: { clientId, domain: HOST, displayName: "Content", protocol: "HTTP", crawlFrequency: "MANUAL" }, select: { id: true } })).id;
    bareId = (await db.seoProperty.create({ data: { clientId, domain: `www.${HOST}`, displayName: "No GSC", protocol: "HTTP", crawlFrequency: "MANUAL" }, select: { id: true } })).id;

    const totals = [];
    const pages = [];
    const queries = [];
    const pairs = [];
    for (let i = 0; i < 84; i++) {
      const date = toDbDate(addDays(latest, -i));
      const block = i < 28 ? 2 : i < 56 ? 1 : 0;
      totals.push({ propertyId, date, clicks: 50, impressions: 1000, position: 8 });
      // Decaying: 6, 4, 2 clicks a day per block → 168, 112, 56.
      pages.push({ propertyId, date, page: U("/blog/a"), clicks: [6, 4, 2][block]!, impressions: 100, position: 5 });
      // Low CTR: position 3 with 0 clicks, while the site's own CTR at 3 is 15%.
      pages.push({ propertyId, date, page: U("/services/seo"), clicks: 0, impressions: 20, position: 3 });
      queries.push({ propertyId, date, query: "digital marketing", clicks: 3, impressions: 20, position: 3 });
      queries.push({ propertyId, date, query: "seo agency dubai", clicks: 0, impressions: 10, position: 8 });
      if (block === 2) {
        pairs.push({ propertyId, date, query: "seo agency dubai", page: U("/services/seo"), clicks: 0, impressions: 10, position: 8 });
        // Two pages splitting one query.
        pairs.push({ propertyId, date, query: "dubai seo", page: U("/services/seo"), clicks: 1, impressions: 3, position: 6 });
        pairs.push({ propertyId, date, query: "dubai seo", page: U("/blog/a"), clicks: 0, impressions: 2, position: 9 });
      }
    }
    await db.gscDailyTotal.createMany({ data: totals });
    await db.gscPageDaily.createMany({ data: pages });
    await db.gscQueryDaily.createMany({ data: queries });
    await db.gscQueryPageDaily.createMany({ data: pairs });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!clientId) return;
    await db.seoProperty.deleteMany({ where: { clientId } });
    await db.client.delete({ where: { id: clientId } });
  });

  it("keeps page text only while a crawl runs, and clears it when cancelled", async () => {
    const started = await startCrawl(manager(), propertyId);
    await advanceCrawls({ ...work(), chunkPages: 2 });
    expect(await db.crawlPage.count({ where: { runId: started.id, textContent: { not: null } } })).toBeGreaterThan(0);
    await cancelCrawl(manager(), started.id);
    expect(await db.crawlPage.count({ where: { runId: started.id, textContent: { not: null } } })).toBe(0);
  });

  it("suggests links when a crawl finishes, then clears the text", async () => {
    await crawl(propertyId);
    const run = await db.crawlRun.findFirstOrThrow({ where: { propertyId, status: "SUCCEEDED" }, orderBy: { startedAt: "desc" } });
    expect(run.suggestionCount).toBe(1);
    expect(await db.crawlPage.count({ where: { runId: run.id, textContent: { not: null } } })).toBe(0);

    const result = await listLinkSuggestions(manager(), propertyId);
    expect(result.list.rows).toHaveLength(1);
    const group = result.list.rows[0]!;
    expect(group).toMatchObject({ target: U("/services/seo"), query: "seo agency dubai", impressions: 280 });
    // Not /blog/b (links already) nor /blog/c (noindex), nor the target itself.
    expect(group.sources.map((s) => s.url)).toEqual([U("/blog/a")]);
    expect(group.sources[0]?.snippet).toContain("SEO agency Dubai");
    expect(group.sources[0]?.clicks).toBe(56);
  });

  it("makes no suggestions, and says so, without Search Console", async () => {
    SITE["/x"] = SITE["/"] as string;
    await crawl(bareId);
    const run = await db.crawlRun.findFirstOrThrow({ where: { propertyId: bareId, status: "SUCCEEDED" } });
    expect(run.suggestionCount).toBeNull();
    expect(await db.crawlPage.count({ where: { runId: run.id, textContent: { not: null } } })).toBe(0);
  });

  it("lists the most and least linked indexable pages", async () => {
    const { most, least } = await linkExtremes(manager(), propertyId);
    expect(most[0]?.url).toBe(U("/"));
    expect(least.some((page) => page.url === U("/"))).toBe(false);
    expect(least.some((page) => page.url === U("/blog/c"))).toBe(false);
  });

  it("finds decaying, low-CTR and cannibalised content with its evidence", async () => {
    await expect(contentFindings(staff(["seo.intelligence.view"], { type: "CLIENT", clientId }), propertyId)).rejects.toThrow(ForbiddenError);

    const decay = await contentFindings(manager(), propertyId, { type: "decaying" });
    expect(decay.hasData).toBe(true);
    if (!decay.hasData) return;
    expect(decay.historyComplete).toBe(true);
    expect(decay.list.rows[0]).toMatchObject({ type: "decaying", url: U("/blog/a"), clicks: [168, 112, 56], impact: 112 });
    expect(decay.list.rows[0]?.type === "decaying" && decay.list.rows[0].crawl?.title).toBe("Post A");

    const low = await contentFindings(manager(), propertyId, { type: "low-ctr" });
    expect(low.list.rows.map((row) => ("url" in row ? row.url : ""))).toContain(U("/services/seo"));

    const cannibal = await contentFindings(manager(), propertyId, { type: "cannibalisation" });
    expect(cannibal.list.rows[0]).toMatchObject({ type: "cannibalisation", query: "dubai seo", impressions: 140 });
    expect(cannibal.counts).toMatchObject({ decaying: 1, cannibalisation: 1 });
  });

  it("hides a deleted client's findings and suggestions", async () => {
    await db.client.update({ where: { id: clientId }, data: { deletedAt: new Date() } });
    try {
      await expect(contentFindings(manager(), propertyId)).rejects.toThrow(/not found/);
      await expect(listLinkSuggestions(manager(), propertyId)).rejects.toThrow(/not found/);
    } finally {
      await db.client.update({ where: { id: clientId }, data: { deletedAt: null } });
    }
  });
});
