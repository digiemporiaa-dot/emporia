import { describe, expect, it } from "vitest";
import { RULES, summarize, technicalFindings, type RulePage } from "@/lib/seo-intel/engine/technical";
import { bucketOf, conflictsOf, normalizeInspection, pickInspectionSample } from "@/lib/seo-intel/engine/indexation";

const base: RulePage = {
  url: "https://example.com/",
  state: "FETCHED",
  depth: 0,
  statusCode: 200,
  redirectTo: null,
  contentType: "text/html",
  responseMs: 200,
  canonical: null,
  noindex: false,
  title: "A good title",
  description: "A good description",
  h1Count: 1,
  wordCount: 500,
  contentHash: null,
  lang: "en",
  hreflang: [],
  imagesMissingAlt: 0,
  inSitemap: false,
  inlinks: 1,
  error: null,
};
const p = (path: string, overrides: Partial<RulePage> = {}): RulePage => ({ ...base, url: `https://example.com${path}`, contentHash: path, ...overrides });
const rulesFor = (pages: RulePage[], url: string, links: { from: string; to: string }[] = []) =>
  technicalFindings(pages, links).filter((f) => f.url === url).map((f) => f.rule).sort();

describe("technical rules", () => {
  it("a healthy page has no findings", () => {
    expect(technicalFindings([p("/")], [])).toEqual([]);
  });

  it("every rule has a severity, title and explanation", () => {
    for (const rule of Object.values(RULES)) {
      expect(rule.title.length).toBeGreaterThan(3);
      expect(rule.why.length).toBeGreaterThan(20);
    }
  });

  it("flags broken pages with the pages linking to them", () => {
    const pages = [p("/"), p("/gone", { statusCode: 404 }), p("/boom", { statusCode: 503 })];
    const findings = technicalFindings(pages, [{ from: "https://example.com/", to: "https://example.com/gone" }]);
    const gone = findings.find((f) => f.rule === "http-4xx");
    expect(gone).toMatchObject({ severity: "CRITICAL", url: "https://example.com/gone", detail: { status: 404, linkedFrom: ["https://example.com/"] } });
    expect(findings.some((f) => f.rule === "http-5xx" && f.url.endsWith("/boom"))).toBe(true);
    // Content rules do not run on error pages.
    expect(rulesFor(pages, "https://example.com/gone")).toEqual(["http-4xx"]);
  });

  it("follows redirect chains and catches loops", () => {
    const chain = [
      p("/a", { statusCode: 301, redirectTo: "https://example.com/b", inlinks: 0 }),
      p("/b", { statusCode: 301, redirectTo: "https://example.com/c", inlinks: 0 }),
      p("/c"),
    ];
    const finding = technicalFindings(chain, []).find((f) => f.rule === "redirect-chain");
    expect(finding?.detail).toMatchObject({ hops: 2, chain: ["https://example.com/a", "https://example.com/b", "https://example.com/c"] });

    const loop = [
      p("/x", { statusCode: 302, redirectTo: "https://example.com/y", inlinks: 0 }),
      p("/y", { statusCode: 302, redirectTo: "https://example.com/x", inlinks: 0 }),
    ];
    expect(technicalFindings(loop, []).filter((f) => f.rule === "redirect-loop")).toHaveLength(2);
    // A single redirect is not a chain.
    expect(rulesFor([p("/one", { statusCode: 301, redirectTo: "https://example.com/c", inlinks: 0 }), p("/c")], "https://example.com/one")).toEqual([]);
  });

  it("checks titles, descriptions, headings and length limits", () => {
    expect(rulesFor([p("/t", { title: null, description: null, h1Count: 0 })], "https://example.com/t")).toEqual(["description-missing", "h1-missing", "title-missing"]);
    expect(rulesFor([p("/t", { title: "x".repeat(61), description: "y".repeat(161), h1Count: 2 })], "https://example.com/t")).toEqual([
      "description-too-long",
      "h1-multiple",
      "title-too-long",
    ]);
    // Exactly at the limit is fine.
    expect(rulesFor([p("/t", { title: "x".repeat(60), description: "y".repeat(160) })], "https://example.com/t")).toEqual([]);
  });

  it("finds duplicates among indexable pages only", () => {
    const pages = [
      p("/a", { title: "Same", contentHash: "h" }),
      p("/b", { title: "same", contentHash: "h" }),
      p("/c", { title: "Same", contentHash: "h", noindex: true }),
      p("/d", { title: "Same", contentHash: "h", canonical: "https://example.com/a" }),
    ];
    const findings = technicalFindings(pages, []);
    const titleDupes = findings.filter((f) => f.rule === "title-duplicate").map((f) => f.url).sort();
    expect(titleDupes).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(findings.find((f) => f.rule === "content-duplicate" && f.url.endsWith("/a"))?.detail).toMatchObject({ duplicates: ["https://example.com/b"], count: 2 });
  });

  it("flags sitemap conflicts, orphans and deep pages", () => {
    expect(rulesFor([p("/n", { noindex: true, inSitemap: true })], "https://example.com/n")).toEqual(["noindex-in-sitemap"]);
    expect(rulesFor([p("/o", { inSitemap: true, inlinks: 0, depth: -1 })], "https://example.com/o")).toEqual(["orphan-page"]);
    // The home page is never an orphan.
    expect(rulesFor([p("/", { inSitemap: true, inlinks: 0, depth: 0 })], "https://example.com/")).toEqual([]);
    expect(rulesFor([p("/deep", { depth: 5 })], "https://example.com/deep")).toEqual(["deep-page"]);
    expect(rulesFor([p("/deep", { depth: 4 })], "https://example.com/deep")).toEqual([]);
  });

  it("checks canonicals pointing at broken URLs", () => {
    const pages = [p("/a", { canonical: "https://example.com/gone" }), p("/gone", { statusCode: 404 })];
    expect(rulesFor(pages, "https://example.com/a")).toContain("canonical-to-error");
  });

  it("requires hreflang return links", () => {
    const en = p("/en", { hreflang: [{ lang: "ar", href: "https://example.com/ar" }] });
    const arNoReturn = p("/ar", { hreflang: [] });
    expect(rulesFor([en, arNoReturn], "https://example.com/en")).toContain("hreflang-no-return");
    const arReturn = p("/ar", { hreflang: [{ lang: "en", href: "https://example.com/en" }] });
    expect(rulesFor([en, arReturn], "https://example.com/en")).not.toContain("hreflang-no-return");
  });

  it("reports slow, thin, alt-less, language-less, blocked and failed pages", () => {
    expect(rulesFor([p("/s", { responseMs: 1_501, wordCount: 199, imagesMissingAlt: 3, lang: null })], "https://example.com/s")).toEqual([
      "images-missing-alt",
      "lang-missing",
      "slow-response",
      "thin-content",
    ]);
    expect(rulesFor([p("/b", { state: "BLOCKED", statusCode: null })], "https://example.com/b")).toEqual(["blocked-by-robots"]);
    expect(rulesFor([p("/e", { state: "ERROR", statusCode: null, error: "timeout" })], "https://example.com/e")).toEqual(["fetch-error"]);
  });

  it("summarises by severity", () => {
    const findings = technicalFindings([p("/gone", { statusCode: 404 }), p("/t", { title: null })], []);
    expect(summarize(findings)).toEqual({ CRITICAL: 1, WARNING: 1, NOTICE: 0 });
  });
});

describe("indexation", () => {
  it("normalises Google's answer and ignores junk", () => {
    const result = normalizeInspection({
      indexStatusResult: {
        verdict: "PASS",
        coverageState: "Submitted and indexed",
        googleCanonical: "https://example.com/",
        userCanonical: "https://example.com/",
        lastCrawlTime: "2026-09-30T10:00:00Z",
        sitemap: ["https://example.com/sitemap.xml", 5],
      },
    });
    expect(result).toMatchObject({ verdict: "PASS", coverageState: "Submitted and indexed", sitemaps: ["https://example.com/sitemap.xml"] });
    expect(result.lastCrawlTime?.toISOString()).toBe("2026-09-30T10:00:00.000Z");
    expect(normalizeInspection(null)).toMatchObject({ verdict: null, sitemaps: [], lastCrawlTime: null });
    expect(normalizeInspection({ indexStatusResult: { lastCrawlTime: "not a date" } }).lastCrawlTime).toBeNull();
  });

  it("buckets results", () => {
    expect(bucketOf(null)).toBe("not-inspected");
    expect(bucketOf({ verdict: "PASS", coverageState: "Submitted and indexed" })).toBe("indexed");
    expect(bucketOf({ verdict: "NEUTRAL", coverageState: "URL is unknown to Google" })).toBe("unknown-to-google");
    expect(bucketOf({ verdict: "NEUTRAL", coverageState: "Crawled - currently not indexed" })).toBe("not-indexed");
    expect(bucketOf({ verdict: null, coverageState: null, error: "403" })).toBe("error");
  });

  it("finds disagreements between the crawl and Google", () => {
    const notIndexed = { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed", googleCanonical: null, userCanonical: null };
    expect(conflictsOf({ indexable: true }, notIndexed)).toEqual(["indexable-not-indexed"]);
    const indexed = { verdict: "PASS", coverageState: "Submitted and indexed", googleCanonical: "https://e.com/b", userCanonical: "https://e.com/a" };
    expect(conflictsOf({ indexable: false }, indexed)).toEqual(["not-indexable-but-indexed", "canonical-mismatch"]);
    expect(conflictsOf({ indexable: true }, null)).toEqual([]);
  });

  it("samples sitemap URLs first, then indexable pages, then the stalest", () => {
    const now = new Date("2026-10-04T00:00:00Z");
    const candidates = [
      { url: "a", inSitemap: false, indexable: true },
      { url: "b", inSitemap: true, indexable: true },
      { url: "c", inSitemap: true, indexable: false },
      { url: "d", inSitemap: false, indexable: false },
      { url: "old", inSitemap: true, indexable: true },
      { url: "older", inSitemap: true, indexable: true },
      { url: "recent", inSitemap: true, indexable: true },
    ];
    const inspected = new Map([
      ["old", new Date("2026-09-10T00:00:00Z")],
      ["older", new Date("2026-09-01T00:00:00Z")],
      ["recent", new Date("2026-10-01T00:00:00Z")],
    ]);
    expect(pickInspectionSample(candidates, inspected, 10, now)).toEqual(["b", "c", "a", "older", "old"]);
    expect(pickInspectionSample(candidates, inspected, 2, now)).toEqual(["b", "c"]);
    expect(pickInspectionSample(candidates, inspected, 0, now)).toEqual([]);
  });
});
