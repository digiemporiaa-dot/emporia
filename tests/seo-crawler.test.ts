import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isLikelyNonHtml, isOnSite, normalizeUrl, robotsPath, siteHosts } from "@/lib/seo-intel/crawler/url";
import { isAllowed, parseRobots } from "@/lib/seo-intel/crawler/robots";
import { parseSitemap } from "@/lib/seo-intel/crawler/sitemap";
import { hasNoindex, parsePage } from "@/lib/seo-intel/crawler/parse";
import { fetchFollowing, publicResolver, safeFetch } from "@/lib/seo-intel/crawler/fetch";
import { UnsafeTargetError } from "@/lib/seo-intel/net/safe-url";

describe("crawler URLs", () => {
  it("normalises links against the page", () => {
    expect(normalizeUrl("/about#team", "https://Example.com/x/")).toBe("https://example.com/about");
    expect(normalizeUrl("../a?b=1", "https://example.com/x/y/")).toBe("https://example.com/x/a?b=1");
    expect(normalizeUrl("https://example.com:443/")).toBe("https://example.com/");
  });

  it("refuses what cannot be crawled", () => {
    for (const href of ["mailto:a@b.com", "tel:+91", "javascript:void(0)", "data:text/html,x", "", "https://u:p@example.com/"]) {
      expect(normalizeUrl(href, "https://example.com/")).toBeNull();
    }
  });

  it("treats www and the bare domain as one site, nothing else", () => {
    const hosts = siteHosts("www.example.com");
    expect(isOnSite("https://example.com/a", hosts)).toBe(true);
    expect(isOnSite("https://www.example.com/a", hosts)).toBe(true);
    expect(isOnSite("https://blog.example.com/a", hosts)).toBe(false);
    expect(isOnSite("https://example.com.evil.com/a", hosts)).toBe(false);
  });

  it("skips files that are not pages", () => {
    expect(isLikelyNonHtml("https://example.com/brochure.PDF")).toBe(true);
    expect(isLikelyNonHtml("https://example.com/img/logo.png?v=2")).toBe(true);
    expect(isLikelyNonHtml("https://example.com/services/seo")).toBe(false);
    expect(isLikelyNonHtml("https://example.com/v1.2/page")).toBe(false);
  });

  it("matches robots rules against path and query", () => {
    expect(robotsPath("https://example.com/a/b?c=1")).toBe("/a/b?c=1");
  });
});

describe("robots.txt", () => {
  const robots = parseRobots(`
    # comment
    User-agent: *
    Disallow: /private/
    Allow: /private/open
    Disallow: /*.pdf$
    Disallow:

    User-agent: EmporiaSEOBot
    Disallow: /no-bots/

    Sitemap: https://example.com/sitemap.xml
  `);
  const ua = "EmporiaSEOBot/1.0";

  it("uses the group naming this crawler over *", () => {
    expect(isAllowed(robots, ua, "/no-bots/x")).toBe(false);
    expect(isAllowed(robots, ua, "/private/x")).toBe(true);
    expect(isAllowed(robots, "OtherBot", "/private/x")).toBe(false);
  });

  it("lets the longest rule win, allow winning a tie", () => {
    expect(isAllowed(robots, "OtherBot", "/private/open/page")).toBe(true);
    const tie = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a");
    expect(isAllowed(tie, ua, "/a")).toBe(true);
  });

  it("supports * and $", () => {
    expect(isAllowed(robots, "OtherBot", "/files/report.pdf")).toBe(false);
    expect(isAllowed(robots, "OtherBot", "/files/report.pdf?x")).toBe(true);
  });

  it("collects sitemaps and allows everything when empty", () => {
    expect(robots.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    expect(isAllowed(parseRobots(""), ua, "/anything")).toBe(true);
  });

  it("groups consecutive user-agent lines", () => {
    const grouped = parseRobots("User-agent: a\nUser-agent: b\nDisallow: /x");
    expect(isAllowed(grouped, "b", "/x")).toBe(false);
    expect(isAllowed(grouped, "a", "/x")).toBe(false);
  });
});

describe("sitemaps", () => {
  it("reads page URLs and nested sitemaps", () => {
    const urlset = parseSitemap(`<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/</loc></url>
        <url><loc> https://example.com/a?x=1&amp;y=2 </loc><lastmod>2026-01-01</lastmod></url>
      </urlset>`);
    expect(urlset.urls).toEqual(["https://example.com/", "https://example.com/a?x=1&y=2"]);

    const index = parseSitemap(`<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap></sitemapindex>`);
    expect(index).toEqual({ urls: [], sitemaps: ["https://example.com/s1.xml"] });
  });

  it("caps the number of URLs", () => {
    const xml = `<urlset>${Array.from({ length: 10 }, (_, i) => `<url><loc>https://example.com/${i}</loc></url>`).join("")}</urlset>`;
    expect(parseSitemap(xml, 3).urls).toHaveLength(3);
  });
});

describe("page parsing", () => {
  const html = `<!doctype html><html lang="en-IN"><head>
    <base href="https://example.com/base/">
    <title> Digital   Marketing &amp; SEO </title>
    <meta name="description" content="We grow brands.">
    <meta name="robots" content="index, follow">
    <link rel="canonical" href="/services/">
    <link rel="alternate" hreflang="en-AE" href="https://example.com/ae/">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["Service","Thing"]}]}</script>
    <script type="application/ld+json">{ not json</script>
    <style>.x{}</style>
  </head><body>
    <h1>Grow <em>faster</em></h1><h1>Second</h1><h2>a</h2><h2>b</h2>
    <p>One two three four five.</p>
    <script>var hidden = "do not count these words";</script>
    <img src="a.png" alt="A"><img src="b.png"><img src="c.png" alt="">
    <a href="contact">Contact us</a>
    <a href="/contact">Duplicate</a>
    <a href="https://other.com/" rel="nofollow sponsored">Partner</a>
    <a href="mailto:hi@example.com">Mail</a>
    <div itemscope itemtype="https://schema.org/LocalBusiness"></div>
  </body></html>`;
  const page = parsePage(html, "https://example.com/services/seo");

  it("reads head fields, resolving against <base>", () => {
    expect(page.title).toBe("Digital Marketing & SEO");
    expect(page.description).toBe("We grow brands.");
    expect(page.metaRobots).toBe("index, follow");
    expect(page.canonical).toBe("https://example.com/services/");
    expect(page.lang).toBe("en-IN");
    expect(page.hreflang).toEqual([{ lang: "en-ae", href: "https://example.com/ae/" }]);
  });

  it("counts headings and keeps the first H1's text", () => {
    expect(page.h1).toBe("Grow faster");
    expect(page.h1Count).toBe(2);
    expect(page.h2Count).toBe(2);
  });

  it("collects schema types from JSON-LD and microdata, ignoring invalid JSON", () => {
    expect(new Set(page.schemaTypes)).toEqual(new Set(["Organization", "Service", "Thing", "LocalBusiness"]));
  });

  it("counts only images with no alt attribute as missing", () => {
    expect(page.imageCount).toBe(3);
    expect(page.imagesMissingAlt).toBe(1);
  });

  it("dedupes links and records nofollow", () => {
    expect(page.links).toEqual([
      { url: "https://example.com/base/contact", anchor: "Contact us", nofollow: false },
      { url: "https://example.com/contact", anchor: "Duplicate", nofollow: false },
      { url: "https://other.com/", anchor: "Partner", nofollow: true },
    ]);
  });

  it("counts visible words only and hashes the text", () => {
    expect(page.wordCount).toBeGreaterThan(5);
    expect(page.wordCount).toBeLessThan(25);
    expect(page.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsePage(html.replace("five", "six"), "https://example.com/").contentHash).not.toBe(page.contentHash);
  });

  it("detects noindex from meta or header", () => {
    expect(hasNoindex("index, follow", null)).toBe(false);
    expect(hasNoindex(null, "googlebot: noindex")).toBe(true);
    expect(hasNoindex("none")).toBe(true);
  });

  it("survives an empty document", () => {
    const empty = parsePage("", "https://example.com/");
    expect(empty.title).toBeNull();
    expect(empty.wordCount).toBe(0);
    expect(empty.contentHash).toBeNull();
  });
});

describe("safe fetch", () => {
  let server: Server;
  let port = 0;
  const local = async () => ["127.0.0.1"];

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/gz") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(gzipSync("<title>zipped</title>"));
      } else if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("x".repeat(50_000));
      } else if (req.url === "/hop") {
        res.writeHead(301, { location: "/end" });
        res.end();
      } else if (req.url === "/away") {
        res.writeHead(302, { location: "http://10.0.0.1/" });
        res.end();
      } else if (req.url === "/slow") {
        setTimeout(() => res.end("late"), 2_000);
      } else {
        res.writeHead(200, { "content-type": "text/html", "x-host": req.headers.host ?? "" });
        res.end(`ok ${req.url}`);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("connects to the resolved address while sending the real host name", async () => {
    const result = await safeFetch("http://site.example.com/a", { resolve: local, port });
    expect(result.status).toBe(200);
    expect(result.body.toString()).toBe("ok /a");
    expect(result.headers["x-host"]).toContain("site.example.com");
  });

  it("decompresses gzip and caps the body", async () => {
    expect((await safeFetch("http://site.example.com/gz", { resolve: local, port })).body.toString()).toBe("<title>zipped</title>");
    const big = await safeFetch("http://site.example.com/big", { resolve: local, port, maxBytes: 1_000 });
    expect(big.truncated).toBe(true);
    expect(big.body.length).toBe(1_000);
  });

  it("does not follow redirects itself; fetchFollowing does, within the allowed set", async () => {
    const hop = await safeFetch("http://site.example.com/hop", { resolve: local, port });
    expect(hop.status).toBe(301);
    const followed = await fetchFollowing("http://site.example.com/hop", { resolve: local, port });
    expect(followed.body.toString()).toBe("ok /end");
    // Each hop is a fresh checked request: a redirect into a private address is refused.
    await expect(fetchFollowing("http://site.example.com/away", { resolve: local, port })).rejects.toThrow(UnsafeTargetError);
    // And a hop outside the allowed set is returned, not followed.
    const stopped = await fetchFollowing("http://site.example.com/hop", { resolve: local, port, allowed: () => false });
    expect(stopped.status).toBe(301);
  });

  it("times out", async () => {
    await expect(safeFetch("http://site.example.com/slow", { resolve: local, port, timeoutMs: 200 })).rejects.toThrow(/No complete response/);
  });

  it("refuses unsafe targets before connecting", async () => {
    await expect(safeFetch("http://127.0.0.1/", { port })).rejects.toThrow(UnsafeTargetError);
    await expect(safeFetch("http://localhost/", { port })).rejects.toThrow(UnsafeTargetError);
    await expect(safeFetch("http://site.example.com:8080/", { resolve: local })).rejects.toThrow(UnsafeTargetError);
  });

  it("the production resolver refuses a name that resolves to a private address", async () => {
    // localhost.example names are refused by spelling; this checks the resolver itself.
    await expect(publicResolver("localtest.me")).rejects.toThrow(UnsafeTargetError);
  });
});
