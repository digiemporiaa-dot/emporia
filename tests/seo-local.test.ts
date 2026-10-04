import { describe, expect, it } from "vitest";
import {
  cellStatus,
  cityTerms,
  fold,
  hasPhrase,
  matchCoverage,
  parseTerms,
  pathWords,
  serviceTerms,
  termsFromServiceName,
  type CoveragePage,
} from "@/lib/seo-intel/engine/local";
import { parsePage } from "@/lib/seo-intel/crawler/parse";

const page = (path: string, overrides: Partial<CoveragePage> = {}): CoveragePage => ({
  url: `https://example.com${path}`,
  title: null,
  h1: null,
  statusCode: 200,
  indexable: true,
  inlinks: 1,
  ...overrides,
});
const delhi = { id: "delhi", name: "Delhi", slug: "delhi", aliases: [] };
const pune = { id: "pune", name: "Pune", slug: "pune", aliases: [] };
const bengaluru = { id: "blr", name: "Bengaluru", slug: "bengaluru", aliases: ["bangalore"] };
const seo = { id: "seo", name: "SEO", terms: ["seo", "search engine optimisation"] };
const ppc = { id: "ppc", name: "Google Ads", terms: [] };

describe("words", () => {
  it("folds case, accents and punctuation into padded words", () => {
    expect(fold("Café-SEO, São Paulo!")).toBe(" cafe seo sao paulo ");
    expect(fold("---")).toBe(" ");
    expect(hasPhrase(fold("best SEO agency in New Delhi"), "new delhi")).toBe(true);
    expect(hasPhrase(fold("delhite seo"), "delhi")).toBe(false);
    expect(hasPhrase(fold("anything"), "!!")).toBe(false);
    expect(pathWords("https://e.com/seo-services/new%20delhi/")).toBe(" seo services new delhi ");
    expect(pathWords("https://e.com/%E0%A4%")).toBe(" e0 a4 ");
    expect(pathWords("not a url")).toBe(" ");
  });

  it("terms: city name, slug and aliases; service terms or its name", () => {
    expect(cityTerms({ id: "x", name: "New Delhi", slug: "new-delhi", aliases: ["ndls", "New  Delhi"] })).toEqual(["New Delhi", "ndls"]);
    expect(serviceTerms(ppc)).toEqual(["Google Ads"]);
    expect(serviceTerms(seo)).toEqual(["seo", "search engine optimisation"]);
  });

  it("parses term lists and CMS service names", () => {
    expect(parseTerms("SEO, search engine  optimisation\nseo,  ,x", 10)).toEqual({ terms: ["seo", "search engine optimisation"], rejected: ["x"] });
    expect(parseTerms("a1, b2, c3", 2)).toEqual({ terms: ["a1", "b2"], rejected: ["c3"] });
    expect(parseTerms("!!!", 5).rejected).toEqual(["!!!"]);
    expect(parseTerms("y".repeat(81), 5).rejected).toHaveLength(1);
    expect(termsFromServiceName("SEO Services")).toEqual(["seo services", "seo"]);
    expect(termsFromServiceName("Web Design Solution")).toEqual(["web design solution", "web design"]);
    expect(termsFromServiceName("Social Media Marketing")).toEqual(["social media marketing"]);
  });
});

describe("coverage matching", () => {
  const run = (pages: CoveragePage[], extra: Partial<Parameters<typeof matchCoverage>[0]> = {}) =>
    matchCoverage({ services: [seo, ppc], cities: [delhi, pune, bengaluru], pages, queries: [], ...extra });
  const cell = (cells: ReturnType<typeof matchCoverage>, serviceId: string, cityId: string) =>
    cells.find((c) => c.serviceId === serviceId && c.cityId === cityId)!;

  it("one cell per service and city", () => {
    expect(run([])).toHaveLength(6);
    expect(run([]).every((c) => c.page === null && c.demand.impressions === 0)).toBe(true);
  });

  it("prefers the URL, then title or H1, then a mix", () => {
    const pages = [
      page("/blog/seo-tips", { title: "SEO in Delhi" }),
      page("/seo/delhi"),
      page("/pune", { h1: "Search engine optimisation services" }),
      page("/bangalore-agency", { title: "Google Ads" }),
    ];
    const cells = run(pages);
    expect(cell(cells, "seo", "delhi").page).toEqual({ url: "https://example.com/seo/delhi", how: "url" });
    expect(cell(cells, "seo", "pune").page).toEqual({ url: "https://example.com/pune", how: "mixed" });
    expect(cell(cells, "ppc", "blr").page).toEqual({ url: "https://example.com/bangalore-agency", how: "mixed" });
    expect(cell(cells, "ppc", "delhi").page).toBeNull();
    const titleOnly = run([page("/x", { title: "SEO in Delhi" })]);
    expect(cell(titleOnly, "seo", "delhi").page).toEqual({ url: "https://example.com/x", how: "title" });
  });

  it("ties: indexable, then more inlinks, then the shorter URL; only 200 pages", () => {
    expect(cell(run([page("/seo-delhi-a", { indexable: false, inlinks: 9 }), page("/seo-delhi-long", { inlinks: 0 })]), "seo", "delhi").page?.url).toBe("https://example.com/seo-delhi-long");
    expect(cell(run([page("/seo-delhi-b", { inlinks: 2 }), page("/seo-delhi", { inlinks: 3 })]), "seo", "delhi").page?.url).toBe("https://example.com/seo-delhi");
    expect(cell(run([page("/seo-delhi-bb"), page("/seo-delhi-a")]), "seo", "delhi").page?.url).toBe("https://example.com/seo-delhi-a");
    expect(cell(run([page("/seo-delhi-b"), page("/seo-delhi-a")]), "seo", "delhi").page?.url).toBe("https://example.com/seo-delhi-a");
    expect(cell(run([page("/seo-delhi", { statusCode: 404 })]), "seo", "delhi").page).toBeNull();
  });

  it("a staff choice beats the CMS, which beats a guess", () => {
    const pages = [page("/seo/delhi")];
    const chosen = new Map([["seo:delhi", "https://example.com/chosen"]]);
    const cms = new Map([["seo:delhi", "https://example.com/services/seo/delhi"], ["seo:pune", "https://example.com/services/seo/pune"]]);
    const cells = run(pages, { chosen, cms });
    expect(cell(cells, "seo", "delhi").page).toEqual({ url: "https://example.com/chosen", how: "chosen" });
    expect(cell(cells, "seo", "pune").page).toEqual({ url: "https://example.com/services/seo/pune", how: "cms" });
    expect(cell(run(pages, { cms }), "seo", "delhi").page?.how).toBe("cms");
  });

  it("demand: queries naming both the city and the service, top five by impressions", () => {
    const queries = [
      { query: "seo delhi", clicks: 5, impressions: 100 },
      { query: "seo company new delhi", clicks: 1, impressions: 40 },
      { query: "seo pune", clicks: 2, impressions: 30 },
      { query: "delhi weather", clicks: 9, impressions: 900 },
      { query: "search engine optimisation delhi", clicks: 0, impressions: 10 },
      { query: "seo bangalore", clicks: 3, impressions: 50 },
      ...["a", "b", "c", "d"].map((q) => ({ query: `seo delhi ${q}`, clicks: 0, impressions: 1 })),
    ];
    const cells = run([], { queries });
    const d = cell(cells, "seo", "delhi").demand;
    expect(d.impressions).toBe(154);
    expect(d.clicks).toBe(6);
    expect(d.queries.map((q) => q.query)).toEqual(["seo delhi", "seo company new delhi", "search engine optimisation delhi", "seo delhi a", "seo delhi b"]);
    expect(cell(cells, "seo", "blr").demand.impressions).toBe(50);
    expect(cell(cells, "ppc", "delhi").demand.impressions).toBe(0);
  });
});

describe("cell status", () => {
  const p = { url: "u", how: "url" as const };
  it("decides what a cell needs", () => {
    expect(cellStatus({ page: null, crawled: null })).toBe("gap");
    expect(cellStatus({ page: null, crawled: null, cmsStatus: "DRAFT" })).toBe("draft");
    expect(cellStatus({ page: { url: "u", how: "cms" }, crawled: { statusCode: 200, indexable: true }, cmsStatus: "DRAFT" })).toBe("draft");
    expect(cellStatus({ page: { url: "u", how: "cms" }, crawled: { statusCode: 200, indexable: true }, cmsStatus: "PUBLISHED" })).toBe("covered");
    expect(cellStatus({ page: p, crawled: null })).toBe("not-crawled");
    expect(cellStatus({ page: p, crawled: { statusCode: 200, indexable: true } })).toBe("covered");
    expect(cellStatus({ page: p, crawled: { statusCode: 200, indexable: false } })).toBe("not-indexable");
    expect(cellStatus({ page: p, crawled: { statusCode: 301, indexable: null } })).toBe("not-indexable");
  });
});

describe("parser: business entities and phone links", () => {
  it("reads LocalBusiness JSON-LD, nested and in @graph, and tel: links", () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", name: "Site" },
          {
            "@type": ["ProfessionalService"],
            name: "Northwind Studio",
            telephone: "+91 98765 43210",
            address: { "@type": "PostalAddress", streetAddress: "12 MG Road", addressLocality: "Pune", addressRegion: "MH", postalCode: "411001", addressCountry: { "@type": "Country", name: "IN" } },
            geo: { "@type": "GeoCoordinates", latitude: 18.5, longitude: 73.8 },
            openingHoursSpecification: [{ dayOfWeek: "Monday" }],
          },
          { "@type": "Organization", name: "No address org" },
          { "@type": "Event", name: "Meetup", location: { "@type": "Place", name: "Hall", address: "1 Main St, Pune" } },
        ],
      })}</script></head>
      <body><a href="tel:+91-98765-43210">Call</a><a href="TEL:%2B91%2020%201234">Office</a><a href="tel:+91-98765-43210">Again</a><a href="tel:">Empty</a></body></html>`;
    const parsed = parsePage(html, "https://example.com/");
    expect(parsed.localBusiness).toEqual([
      {
        types: ["ProfessionalService"],
        name: "Northwind Studio",
        telephone: "+91 98765 43210",
        address: { street: "12 MG Road", locality: "Pune", region: "MH", postalCode: "411001", country: "IN" },
        hasGeo: true,
        hasHours: true,
        url: null,
      },
      { types: ["Place"], name: "Hall", telephone: null, address: { street: "1 Main St, Pune", locality: null, region: null, postalCode: null, country: null }, hasGeo: false, hasHours: false, url: null },
    ]);
    expect(parsed.phones).toEqual(["+91-98765-43210", "+91 20 1234"]);
    expect(parsed.schemaTypes).toEqual(expect.arrayContaining(["ProfessionalService", "Organization", "Place"]));
  });

  it("no entities without a local type or an address; at most five", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ "@type": "Store", name: `S${i}` }));
    const parsed = parsePage(`<script type="application/ld+json">${JSON.stringify(many)}</script>`, "https://example.com/");
    expect(parsed.localBusiness).toHaveLength(5);
    expect(parsePage(`<script type="application/ld+json">{"@type":"Organization","name":"x"}</script>`, "https://example.com/").localBusiness).toEqual([]);
    expect(parsePage(`<script type="application/ld+json">{"@type":"Store","address":["9 Lane"],"openingHours":"Mo-Fr"}</script>`, "https://example.com/").localBusiness[0]).toMatchObject({ address: { street: "9 Lane" }, hasHours: true, name: null });
  });
});
