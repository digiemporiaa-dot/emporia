import { describe, expect, it } from "vitest";
import {
  areLocaleVariants,
  checkHreflang,
  countriesWithoutVersion,
  countriesWithVersion,
  declaredVersions,
  localeSegment,
  primaryLanguage,
} from "@/lib/seo-intel/engine/international";
import { technicalFindings, type RulePage } from "@/lib/seo-intel/engine/technical";
import { alpha2FromAlpha3, isLanguageCode } from "@/lib/geo/iso";

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
const u = (path: string) => `https://example.com${path}`;
const p = (path: string, overrides: Partial<RulePage> = {}): RulePage => ({ ...base, url: u(path), contentHash: path, ...overrides });
const set = (...entries: [string, string][]) => entries.map(([lang, path]) => ({ lang, href: u(path) }));
const rulesFor = (pages: RulePage[], path: string) =>
  technicalFindings(pages, []).filter((f) => f.url === u(path)).map((f) => f.rule).sort();
const detailOf = (pages: RulePage[], path: string, rule: string) => technicalFindings(pages, []).find((f) => f.url === u(path) && f.rule === rule)?.detail;

describe("ISO tables", () => {
  it("maps Search Console's alpha-3 countries and knows ISO 639-1 languages", () => {
    expect([alpha2FromAlpha3("ind"), alpha2FromAlpha3("ARE"), alpha2FromAlpha3("gbr"), alpha2FromAlpha3("xkk"), alpha2FromAlpha3("zzz")]).toEqual(["IN", "AE", "GB", "XK", null]);
    expect([isLanguageCode("en"), isLanguageCode("HI"), isLanguageCode("xx"), isLanguageCode("eng")]).toEqual([true, true, false, false]);
  });
});

describe("hreflang codes", () => {
  it("accepts language, language-region, scripts and x-default", () => {
    expect(checkHreflang("en")).toEqual({ ok: true, xDefault: false, language: "en", region: null });
    expect(checkHreflang("en-IN")).toEqual({ ok: true, xDefault: false, language: "en", region: "IN" });
    expect(checkHreflang("zh-Hant-TW")).toMatchObject({ ok: true, language: "zh", region: "TW" });
    expect(checkHreflang("zh-hant")).toMatchObject({ ok: true, language: "zh", region: null });
    expect(checkHreflang("x-default")).toMatchObject({ ok: true, xDefault: true });
  });

  it("refuses what Google ignores, saying why", () => {
    expect(checkHreflang("en-uk")).toEqual({ ok: false, reason: '"uk" is not a country code; use gb.' });
    expect(checkHreflang("en_IN")).toMatchObject({ ok: false, reason: expect.stringContaining("en-in") });
    expect(checkHreflang("eng")).toMatchObject({ ok: false });
    expect(checkHreflang("xx-IN")).toMatchObject({ ok: false });
    expect(checkHreflang("es-419")).toMatchObject({ ok: false, reason: expect.stringContaining("419") });
    expect(checkHreflang("en-in-x")).toMatchObject({ ok: false });
    expect(checkHreflang("in")).toMatchObject({ ok: false }); // India is a country, not a language
  });

  it("primary language of an html lang", () => {
    expect([primaryLanguage("en-IN"), primaryLanguage("AR"), primaryLanguage(null), primaryLanguage(" ")]).toEqual(["en", "ar", null, null]);
  });
});

describe("locale paths", () => {
  it("finds a leading locale segment and the rest of the URL", () => {
    expect(localeSegment("https://www.example.com/ae/services/seo")).toEqual({ segment: "ae", rest: "example.com/services/seo" });
    expect(localeSegment("https://example.com/en-in/")).toEqual({ segment: "en-in", rest: "example.com/" });
    expect(localeSegment("https://example.com/en_IN")).toEqual({ segment: "en-in", rest: "example.com/" });
    expect(localeSegment("https://example.com/blog/x")).toEqual({ segment: null, rest: "example.com/blog/x" });
    expect(localeSegment("https://example.com/xq/x").segment).toBeNull();
    expect(localeSegment("https://example.com/aegis").segment).toBeNull();
  });

  it("locale variants share everything but the segment", () => {
    expect(areLocaleVariants(u("/ae/seo"), u("/in/seo"))).toBe(true);
    expect(areLocaleVariants(u("/ae/seo"), u("/seo"))).toBe(true);
    expect(areLocaleVariants(u("/ae/seo"), u("/ae/seo"))).toBe(false);
    expect(areLocaleVariants(u("/ae/seo"), u("/in/ppc"))).toBe(false);
    expect(areLocaleVariants(u("/a"), u("/b"))).toBe(false);
  });

  it("countries with a version: hreflang regions, country segments and the default market", () => {
    const pages = [
      { url: u("/"), hreflang: set(["en-ae", "/ae/"], ["ar", "/ar/"], ["x-default", "/"], ["en-uk", "/uk/"]) },
      { url: u("/sa/pricing"), hreflang: [] },
    ];
    // "ar" is a language, "en-uk" is invalid: neither names a country.
    expect([...countriesWithVersion(pages, "in")].sort()).toEqual(["AE", "IN", "SA"]);
    expect([...countriesWithVersion([], null)]).toEqual([]);
  });

  it("declared versions count each code once per page", () => {
    const pages = [
      { hreflang: set(["en", "/"], ["ar", "/ar/"], ["x-default", "/"], ["ar", "/ar2/"]) },
      { hreflang: set(["en", "/a"], ["bad_code", "/b"]) },
    ];
    expect([...declaredVersions(pages)]).toEqual([["en", 2], ["ar", 1]]);
  });

  it("countries without a version: only for multi-version sites, above share and clicks", () => {
    const traffic = [
      { country: "IN", clicks: 500, impressions: 9000 },
      { country: "US", clicks: 100, impressions: 3000 },
      { country: "GB", clicks: 30, impressions: 900 },
      { country: "DE", clicks: 10, impressions: 100 },
    ];
    const options = { minShare: 0.05, minClicks: 20 };
    expect(countriesWithoutVersion(traffic, new Set(["IN"]), false, options)).toEqual([]);
    expect(countriesWithoutVersion(traffic, new Set(["IN"]), true, options).map((row) => row.country)).toEqual(["US"]);
    expect(countriesWithoutVersion(traffic, new Set(["IN"]), true, { minShare: 0.04, minClicks: 20 }).map((row) => row.country)).toEqual(["US", "GB"]);
    expect(countriesWithoutVersion(traffic, new Set(["IN"]), true, { minShare: 0.01, minClicks: 31 }).map((row) => row.country)).toEqual(["US"]);
    expect(countriesWithoutVersion([], new Set(), true, options)).toEqual([]);
    expect(countriesWithoutVersion(traffic, new Set(["IN"]), true, options)[0]?.share).toBeCloseTo(100 / 640);
  });
});

describe("international technical rules", () => {
  const en = (overrides: Partial<RulePage> = {}) => p("/en/", { hreflang: set(["en", "/en/"], ["ar", "/ar/"]), ...overrides });
  const ar = (overrides: Partial<RulePage> = {}) => p("/ar/", { lang: "ar", hreflang: set(["en", "/en/"], ["ar", "/ar/"]), ...overrides });

  it("a correct pair has no international findings", () => {
    expect(rulesFor([en(), ar()], "/en/")).toEqual([]);
    expect(rulesFor([en(), ar()], "/ar/")).toEqual([]);
  });

  it("invalid and duplicated codes", () => {
    const page = en({ hreflang: set(["en", "/en/"], ["en-uk", "/uk/"], ["ar", "/ar/"], ["ar", "/ar2/"]) });
    expect(rulesFor([page, ar()], "/en/")).toEqual(expect.arrayContaining(["hreflang-invalid", "hreflang-duplicate-code"]));
    expect(detailOf([page, ar()], "/en/", "hreflang-invalid")).toEqual({ codes: [{ lang: "en-uk", reason: '"uk" is not a country code; use gb.' }] });
    expect(detailOf([page, ar()], "/en/", "hreflang-duplicate-code")).toEqual({ codes: [{ lang: "ar", urls: [u("/ar/"), u("/ar2/")] }] });
  });

  it("a set without the page itself", () => {
    expect(rulesFor([en({ hreflang: set(["ar", "/ar/"]) }), ar()], "/en/")).toContain("hreflang-no-self");
  });

  it("alternates that redirect, fail, error or are noindex", () => {
    for (const [other, problem] of [
      [ar({ statusCode: 301, redirectTo: u("/x") }), "redirects"],
      [ar({ statusCode: 404 }), "returns 404"],
      [ar({ state: "ERROR", statusCode: null, error: "timeout" }), "could not be fetched"],
      [ar({ noindex: true }), "is noindex"],
    ] as const) {
      expect(detailOf([en(), other], "/en/", "hreflang-to-broken")).toEqual({ alternates: [{ url: u("/ar/"), lang: "ar", problem }] });
    }
    // Not crawled, or blocked: nothing known, nothing said.
    expect(rulesFor([en()], "/en/")).not.toContain("hreflang-to-broken");
    expect(rulesFor([en(), ar({ state: "BLOCKED", statusCode: null })], "/en/")).not.toContain("hreflang-to-broken");
  });

  it("canonical conflicts, on the page or an alternate", () => {
    expect(detailOf([en({ canonical: u("/") }), ar()], "/en/", "hreflang-canonical-conflict")).toEqual({ canonical: u("/"), alternates: [] });
    expect(detailOf([en(), ar({ canonical: u("/") })], "/en/", "hreflang-canonical-conflict")).toEqual({ canonical: null, alternates: [{ url: u("/ar/"), canonical: u("/") }] });
    expect(rulesFor([en({ canonical: u("/en/") }), ar()], "/en/")).not.toContain("hreflang-canonical-conflict");
  });

  it("html lang that contradicts the page's own entry", () => {
    expect(detailOf([en(), ar({ lang: "en" })], "/ar/", "hreflang-lang-mismatch")).toEqual({ lang: "en", hreflang: "ar" });
    expect(rulesFor([en({ lang: "en-IN" }), ar()], "/en/")).not.toContain("hreflang-lang-mismatch");
    expect(rulesFor([en({ lang: null }), ar()], "/en/")).not.toContain("hreflang-lang-mismatch");
  });

  it("noindex pages are not checked", () => {
    expect(rulesFor([en({ noindex: true, hreflang: set(["en-uk", "/x"]) })], "/en/")).not.toContain("hreflang-invalid");
  });

  it("identical country versions: fine with hreflang, a country duplicate without, plain duplicates otherwise", () => {
    const own = (path: string) => p(path, { contentHash: "h", title: `Title ${path}`, description: `About ${path}` });
    const linked = [p("/ae/seo", { contentHash: "h", hreflang: set(["en-ae", "/ae/seo"], ["en-in", "/in/seo"]) }), p("/in/seo", { contentHash: "h", hreflang: set(["en-ae", "/ae/seo"], ["en-in", "/in/seo"]) })];
    // Shared title and description too: versions tied by hreflang may share them.
    expect(rulesFor(linked, "/ae/seo")).toEqual([]);
    expect(rulesFor([own("/ae/x"), own("/in/x")].map((page) => ({ ...page, title: "Same" })), "/ae/x")).toContain("title-duplicate");

    const unlinked = [own("/ae/seo"), own("/in/seo"), own("/other")];
    expect(rulesFor(unlinked, "/ae/seo")).toEqual(["content-duplicate", "country-duplicate"]);
    expect(detailOf(unlinked, "/ae/seo", "country-duplicate")).toEqual({ versions: [u("/in/seo")], count: 2 });
    expect(detailOf(unlinked, "/ae/seo", "content-duplicate")).toEqual({ duplicates: [u("/other")], count: 2 });
    expect(rulesFor(unlinked, "/other")).toEqual(["content-duplicate"]);
    expect(detailOf(unlinked, "/other", "content-duplicate")).toEqual({ duplicates: [u("/ae/seo"), u("/in/seo")], count: 3 });
  });
});
