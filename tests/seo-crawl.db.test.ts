import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import {
  advanceCrawls,
  cancelCrawl,
  crawlIssueSummary,
  getCrawlRun,
  KEEP_CRAWLS,
  listCrawlIssues,
  listCrawlPages,
  startCrawl,
  startDueCrawls,
} from "@/lib/services/seo-intel/crawl.service";
import type { Actor } from "@/lib/actor/types";

/**
 * A whole crawl against a small local site with known problems, through the
 * real fetcher (pinned to the local server), the real parser, the rules and
 * the database.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `cr${Date.now().toString(36)}`;
const HOST = `${TAG}.example.com`;

const page = (title: string, body: string, head = "") =>
  `<!doctype html><html lang="en"><head><title>${title}</title><meta name="description" content="${title} page">${head}</head><body>${body}</body></html>`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

const SITE: Record<string, { status?: number; headers?: Record<string, string>; body?: string }> = {
  "/robots.txt": { headers: { "content-type": "text/plain" }, body: `User-agent: *\nDisallow: /private\nSitemap: http://${HOST}/sitemap.xml\n` },
  "/sitemap.xml": {
    headers: { "content-type": "application/xml" },
    body: `<urlset>${["/", "/about", "/orphan", "/hidden", "/missing"].map((p) => `<url><loc>http://${HOST}${p}</loc></url>`).join("")}</urlset>`,
  },
  "/": { body: page("Home", `<h1>Home</h1><p>${words(300)}</p><a href="/about">About</a><a href="/old">Old</a><a href="/private/x">Private</a><a href="/about#team">Team</a><a href="https://other.example.org/">Elsewhere</a><a href="/dup">Dup</a>`) },
  "/about": { body: page("Same title", `<h1>About</h1><p>${words(250)} identical</p><a href="/">Home</a>`) },
  "/dup": { body: page("Same title", `<h1>About</h1><p>${words(250)} identical</p><a href="/">Home</a>`) },
  "/old": { status: 301, headers: { location: "/older" } },
  "/older": { status: 301, headers: { location: "/about" } },
  "/orphan": { body: page("Orphan", `<h1>Lonely</h1><p>${words(220)}</p>`) },
  "/hidden": { body: page("Hidden", `<h1>Hidden</h1><p>${words(220)}</p>`, `<meta name="robots" content="noindex">`) },
  "/private/x": { body: page("Private", "<h1>Secret</h1>") },
};

describeDb("SEO crawl", () => {
  let server: Server;
  let port = 0;
  let staffId = "";
  let clientId = "";
  let propertyId = "";
  const requests: string[] = [];

  const staff = (permissions: string[]): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "ADMIN", roleId: "r", clientId: null, ip: null, userAgent: null, permissions: new Set(permissions) }) as Actor;
  const manager = () => staff(["seo.intelligence.view", "seo.intelligence.manage"]);
  const work = () => ({ fetch: { resolve: async () => ["127.0.0.1"], port }, budgetMs: 20_000 });

  async function crawlToEnd(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      await advanceCrawls(work());
      const running = await db.crawlRun.count({ where: { propertyId, status: "RUNNING" } });
      if (running === 0) return;
    }
    throw new Error("crawl did not finish");
  }

  beforeAll(async () => {
    server = createServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0] as string;
      requests.push(path);
      const entry = SITE[path];
      if (!entry) {
        res.writeHead(404, { "content-type": "text/html" });
        res.end(page("Not found", "<h1>404</h1>"));
        return;
      }
      res.writeHead(entry.status ?? 200, { "content-type": "text/html; charset=utf-8", ...entry.headers });
      res.end(entry.body ?? "");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;

    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } })).id;
    clientId = (await db.client.create({ data: { name: `Crawl ${TAG}`, slug: `crawl-${TAG}`, ownerId: staffId }, select: { id: true } })).id;
    propertyId = (
      await db.seoProperty.create({
        data: { clientId, domain: HOST, displayName: "Crawl test", protocol: "HTTP", crawlFrequency: "MANUAL" },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!clientId) return;
    await db.seoProperty.deleteMany({ where: { clientId } });
    await db.client.delete({ where: { id: clientId } });
  });

  it("needs the manage permission to start", async () => {
    await expect(startCrawl(staff(["seo.intelligence.view"]), propertyId)).rejects.toThrow(ForbiddenError);
  });

  it("crawls the site and finds its problems", async () => {
    await startCrawl(manager(), propertyId);
    await expect(startCrawl(manager(), propertyId)).rejects.toThrow(ConflictError);
    await crawlToEnd();

    const run = await getCrawlRun(manager(), propertyId);
    expect(run?.status).toBe("SUCCEEDED");
    expect(run?.robotsFound).toBe(true);
    expect(run?.sitemapUrls).toBe(5);
    expect(run?.limitReached).toBe(false);

    // robots.txt was obeyed: the disallowed page was never requested.
    expect(requests).not.toContain("/private/x");
    // External links are counted, never followed.
    expect(requests.every((path) => !path.includes("other.example.org"))).toBe(true);

    const issues = await listCrawlIssues(manager(), run!.id, { perPage: 100 });
    const has = (rule: string, path: string) =>
      issues.rows.some((issue) => issue.rule === rule && issue.page?.url === `http://${HOST}${path}`);

    expect(has("http-4xx", "/missing")).toBe(true);
    expect(has("redirect-chain", "/old")).toBe(true);
    expect(has("internal-redirect", "/old")).toBe(true);
    expect(has("blocked-by-robots", "/private/x")).toBe(true);
    expect(has("orphan-page", "/orphan")).toBe(true);
    expect(has("noindex-in-sitemap", "/hidden")).toBe(true);
    expect(has("title-duplicate", "/about")).toBe(true);
    expect(has("title-duplicate", "/dup")).toBe(true);
    expect(has("content-duplicate", "/dup")).toBe(true);
    // The home page is linked from other pages and is fine.
    expect(issues.rows.some((issue) => issue.page?.url === `http://${HOST}/` && issue.severity !== "NOTICE")).toBe(false);

    const missing = issues.rows.find((issue) => issue.rule === "http-4xx");
    expect((missing?.detail as { inSitemap?: boolean }).inSitemap).toBe(true);

    const summary = await crawlIssueSummary(manager(), run!.id);
    expect(summary[0]?.severity).toBe("CRITICAL");
    expect(run?.summary).toMatchObject({ CRITICAL: expect.any(Number), WARNING: expect.any(Number) });

    const pages = await listCrawlPages(manager(), run!.id, { filter: "indexable", perPage: 50 });
    const about = pages.rows.find((row) => row.url === `http://${HOST}/about`);
    // Linked from the home page only; the #team link is the same page, the redirect chain is not a link.
    expect(about?.inlinks).toBe(1);
    expect(about?.inSitemap).toBe(true);
    expect(pages.rows.some((row) => row.url.endsWith("/hidden"))).toBe(false);

    const blocked = await listCrawlPages(manager(), run!.id, { filter: "blocked" });
    expect(blocked.rows.map((row) => row.url)).toEqual([`http://${HOST}/private/x`]);
  });

  it("stops at the page limit and says so", async () => {
    await db.seoProperty.update({ where: { id: propertyId }, data: { crawlMaxPages: 3 } });
    await startCrawl(manager(), propertyId);
    await crawlToEnd();
    const run = await getCrawlRun(manager(), propertyId);
    expect(run?.limitReached).toBe(true);
    expect(run?.total).toBeLessThanOrEqual(3);
    await db.seoProperty.update({ where: { id: propertyId }, data: { crawlMaxPages: 500 } });
  });

  it("can be cancelled, and a cancelled crawl is not worked on", async () => {
    const started = await startCrawl(manager(), propertyId);
    await cancelCrawl(manager(), started.id);
    const before = requests.length;
    await advanceCrawls(work());
    expect(requests.length).toBe(before);
    expect((await db.crawlRun.findUniqueOrThrow({ where: { id: started.id } })).status).toBe("CANCELLED");
  });

  it("keeps only the last few crawls", async () => {
    await db.seoProperty.update({ where: { id: propertyId }, data: { crawlMaxPages: 1 } });
    for (let i = 0; i < KEEP_CRAWLS + 1; i++) {
      await startCrawl(manager(), propertyId);
      await crawlToEnd();
    }
    expect(await db.crawlRun.count({ where: { propertyId } })).toBe(KEEP_CRAWLS);
  });

  it("starts weekly crawls when due, and only those", async () => {
    const now = new Date();
    await db.seoProperty.update({ where: { id: propertyId }, data: { crawlFrequency: "WEEKLY", nextCrawlAt: new Date(now.getTime() + 60_000) } });
    const notYet = await db.crawlRun.count({ where: { propertyId, status: "RUNNING" } });
    await startDueCrawls({ now, limit: 50 });
    expect(await db.crawlRun.count({ where: { propertyId, status: "RUNNING" } })).toBe(notYet);

    await db.seoProperty.update({ where: { id: propertyId }, data: { nextCrawlAt: new Date(now.getTime() - 60_000) } });
    await startDueCrawls({ now, limit: 50 });
    expect(await db.crawlRun.count({ where: { propertyId, status: "RUNNING", trigger: "SCHEDULED" } })).toBe(1);
    const property = await db.seoProperty.findUniqueOrThrow({ where: { id: propertyId } });
    expect(property.nextCrawlAt!.getTime()).toBeGreaterThan(now.getTime() + 6 * 86_400_000);
    await crawlToEnd();
  });

  it("refuses a site that resolves to a private address", async () => {
    await db.seoProperty.update({ where: { id: propertyId }, data: { crawlFrequency: "MANUAL" } });
    const started = await startCrawl(manager(), propertyId);
    // The production resolver, not the test one: 127.0.0.1 is refused.
    await advanceCrawls({ budgetMs: 5_000, fetch: { port, resolve: async () => { throw new (await import("@/lib/seo-intel/net/safe-url")).UnsafeTargetError("points to a private address"); } } });
    const run = await db.crawlRun.findUniqueOrThrow({ where: { id: started.id } });
    expect(run.status).toBe("FAILED");
    expect(run.error).toMatch(/private/);
  });
});
