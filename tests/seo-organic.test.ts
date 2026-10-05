import { describe, expect, it } from "vitest";
import { isOrganicTouch, isSearchEngine, lowConversionPages, pathKey, rate, urlPathKey } from "@/lib/seo-intel/engine/organic";
import { fromAnalytics } from "@/lib/seo-intel/engine/opportunities";

describe("paths", () => {
  it("one normalisation for CRM paths, GA4 landing pages and Search Console URLs", () => {
    expect([pathKey("/services/seo/"), pathKey("services/seo?utm_source=x"), pathKey("/a#top"), pathKey("/"), pathKey("//"), pathKey(" /b// ")]).toEqual([
      "/services/seo",
      "/services/seo",
      "/a",
      "/",
      "/",
      "/b",
    ]);
    expect(urlPathKey("https://www.example.com/services/seo/?x=1")).toBe("/services/seo");
    expect(urlPathKey("https://example.com")).toBe("/");
    expect(urlPathKey("not a url")).toBeNull();
  });
});

describe("organic visits", () => {
  it("knows search engines by whole host labels", () => {
    for (const referrer of ["https://www.google.com/", "https://google.co.in/search?q=x", "https://www.bing.com/search", "https://duckduckgo.com/", "https://search.yahoo.com/", "https://yandex.ru/", "https://www.baidu.com/", "https://www.ecosia.org/", "https://search.brave.com/", "https://m.search.naver.com/"]) {
      expect(isSearchEngine(referrer)).toBe(true);
    }
    for (const referrer of ["https://notgoogle.com/", "https://google.evil.example/", "https://mail.yahoo.com/", "https://facebook.com/", "garbage", null, undefined, ""]) {
      expect(isSearchEngine(referrer)).toBe(false);
    }
  });

  it("organic: utm_medium=organic, or untagged with a search referrer; other tags win; no touch is unknown", () => {
    expect(isOrganicTouch({ source: "google", medium: "Organic", referrer: null })).toBe(true);
    expect(isOrganicTouch({ source: null, medium: null, referrer: "https://www.google.com/" })).toBe(true);
    expect(isOrganicTouch({ source: "google", medium: "cpc", referrer: "https://www.google.com/" })).toBe(false);
    expect(isOrganicTouch({ source: "newsletter", medium: null, referrer: "https://www.google.com/" })).toBe(false);
    expect(isOrganicTouch({ source: "  ", medium: " ", referrer: "https://www.bing.com/" })).toBe(true);
    expect(isOrganicTouch({ source: null, medium: null, referrer: "https://facebook.com/" })).toBe(false);
    expect(isOrganicTouch({ source: null, medium: null, referrer: null })).toBe(false);
    expect(isOrganicTouch(null)).toBe(false);
  });
});

describe("low-converting organic pages", () => {
  const pages = [
    { path: "/a", sessions: 1000, keyEvents: 2 },
    { path: "/b", sessions: 400, keyEvents: 20 },
    { path: "/c", sessions: 199, keyEvents: 0 },
    { path: "/d", sessions: 200, keyEvents: 0.5 },
    { path: "/e", sessions: 300, keyEvents: 1.5 },
  ];
  it("pages with enough sessions under a share of the site rate, busiest first", () => {
    const found = lowConversionPages(pages, 0.01, { minSessions: 200, rateShare: 0.5 });
    expect(found.map((p) => p.path)).toEqual(["/a", "/d"]);
    expect(found[0]).toEqual({ path: "/a", sessions: 1000, keyEvents: 2, rate: 0.002, siteRate: 0.01 });
    // At exactly half the site's rate a page is not flagged.
    expect(lowConversionPages(pages, 0.01, { minSessions: 200, rateShare: 0.5 }).map((p) => p.path)).not.toContain("/e");
    expect(lowConversionPages(pages, 0.01, { minSessions: 100, rateShare: 0.5 }).map((p) => p.path)).toContain("/c");
    expect(lowConversionPages([{ path: "/x", sessions: 500, keyEvents: 1 }, { path: "/w", sessions: 500, keyEvents: 1 }], 0.01, { minSessions: 1, rateShare: 1 }).map((p) => p.path)).toEqual(["/w", "/x"]);
  });

  it("nothing to compare against without key events", () => {
    expect(lowConversionPages(pages, 0, { minSessions: 1, rateShare: 1 })).toEqual([]);
    expect(lowConversionPages(pages, Number.NaN, { minSessions: 1, rateShare: 1 })).toEqual([]);
  });

  it("rates and candidates", () => {
    expect([rate(1, 4), rate(1, 0)]).toEqual([0.25, null]);
    const candidates = fromAnalytics([
      { path: "/big", sessions: 2000, keyEvents: 1, rate: 0.0005, siteRate: 0.01 },
      { path: "/mid", sessions: 500, keyEvents: 0, rate: 0, siteRate: 0.01 },
      { path: "/small", sessions: 499, keyEvents: 0, rate: 0, siteRate: 0.01 },
    ]);
    expect(candidates.map((c) => [c.fingerprint, c.severity, c.impact, c.impactUnit, c.source])).toEqual([
      ["analytics:low-conversion:/big", "HIGH", 2000, "sessions", "ANALYTICS"],
      ["analytics:low-conversion:/mid", "MEDIUM", 500, "sessions", "ANALYTICS"],
      ["analytics:low-conversion:/small", "LOW", 499, "sessions", "ANALYTICS"],
    ]);
    expect(candidates[0]).toMatchObject({ title: "Organic visitors rarely convert on /big", effort: "MEDIUM", evidence: { path: "/big", siteRate: 0.01 } });
  });
});
