import { describe, expect, it } from "vitest";
import {
  clickSeverity,
  fromChanges,
  fromContent,
  fromIndexation,
  fromInternational,
  fromKeywords,
  fromLinks,
  fromLocal,
  fromNap,
  fromReviews,
  fromTechnical,
  reconcile,
  type Candidate,
  type Stored,
} from "@/lib/seo-intel/engine/opportunities";

const kw = (query: string, extraClicks: number | null, impressions = 100, band: "near-top" | "page-two" = "near-top") => ({ query, clicks: 1, impressions, position: band === "near-top" ? 6 : 14, band, extraClicks });

describe("candidates", () => {
  it("keyword opportunities: strongest first, capped, stable fingerprints", () => {
    const found = fromKeywords([kw("a", 5), kw("b", 80), kw("c", null, 900), kw("d", 20, 100, "page-two")], 3);
    expect(found.map((c) => c.query)).toEqual(["b", "d", "a"]);
    expect(found[0]).toMatchObject({ fingerprint: "keywords:b", source: "KEYWORDS", type: "keyword-near-top", impact: 80, severity: "HIGH", effort: "MEDIUM" });
    expect(found[1]).toMatchObject({ type: "keyword-page-two", severity: "MEDIUM", effort: "HIGH" });
    expect(fromKeywords([kw("x", 1)], 0)).toEqual([]);
  });

  it("severity from clicks", () => {
    expect([clickSeverity(50), clickSeverity(49), clickSeverity(10), clickSeverity(9)]).toEqual(["HIGH", "MEDIUM", "MEDIUM", "LOW"]);
  });

  it("content findings, capped per type, with page or query fingerprints", () => {
    const found = fromContent(
      [
        { type: "decaying", url: "https://e.com/a", impact: 60, clicks: [100, 70, 40], drop: 0.6, crawl: null },
        { type: "decaying", url: "https://e.com/b", impact: 30, clicks: [50, 40, 20], drop: 0.6, crawl: null },
        { type: "low-ctr", url: "https://e.com/c", impact: 12, position: 3, ctr: 0.01, expected: 0.1, impressions: 500, crawl: null },
        { type: "cannibalisation", query: "seo", impact: 600, impressions: 1000, pages: [] },
      ],
      1,
    );
    expect(found.map((c) => c.fingerprint)).toEqual(["content:decaying:https://e.com/a", "content:low-ctr:https://e.com/c", "content:cannibalisation:seo"]);
    expect(found[0]).toMatchObject({ title: "Decaying page: /a", severity: "HIGH", impactUnit: "clicks" });
    expect(found[1]).toMatchObject({ effort: "LOW", severity: "MEDIUM" });
    expect(found[2]).toMatchObject({ impactUnit: "impressions", severity: "HIGH", query: "seo", url: null });
    expect(found[0]?.evidence).not.toHaveProperty("type");
  });

  it("technical: one per critical or warning rule, never notices", () => {
    const found = fromTechnical([
      { rule: "http-4xx", severity: "CRITICAL", count: 3, sample: ["u1", "u2"] },
      { rule: "title-missing", severity: "WARNING", count: 1, sample: [] },
      { rule: "thin-content", severity: "NOTICE", count: 40, sample: [] },
    ]);
    expect(found.map((c) => [c.fingerprint, c.severity, c.impactUnit, c.title])).toEqual([
      ["technical:http-4xx", "HIGH", "pages", "Broken page (4xx) (3 pages)"],
      ["technical:title-missing", "MEDIUM", "pages", "Missing title (1 page)"],
    ]);
  });

  it("indexation, links and changes", () => {
    expect(fromIndexation([{ conflict: "indexable-not-indexed", urls: ["a", "b"] }, { conflict: "canonical-mismatch", urls: [] }])).toHaveLength(1);
    expect(fromLinks([{ target: "https://e.com/t", query: "q", position: 8, impressions: 90, sources: ["s1", "s2"] }])[0]).toMatchObject({ fingerprint: "links:https://e.com/t:q", impact: 2, effort: "LOW" });
    const range = { current: { start: "2026-09-03", end: "2026-09-30" }, previous: { start: "2026-08-06", end: "2026-09-02" } };
    const changes = fromChanges([
      { key: "total-clicks", severity: "high", direction: "down", title: "Clicks fell 40%", source: "Search Console", range, entity: { type: "property", keys: [] }, view: "overview" },
      { key: "total-impressions", severity: "medium", direction: "up", title: "Impressions rose", source: "Search Console", range, entity: { type: "property", keys: [] }, view: "overview" },
      { key: "total-ctr", severity: "low", direction: "down", title: "CTR slipped", source: "Search Console", range, entity: { type: "property", keys: [] }, view: "overview" },
    ]);
    expect(changes.map((c) => c.fingerprint)).toEqual(["changes:total-clicks"]);
  });
});

describe("local and international candidates", () => {
  const cell = (status: "covered" | "not-indexable" | "not-crawled" | "draft" | "gap", impressions: number, url: string | null = null) => ({
    serviceId: "s", serviceName: "SEO", cityId: "c", cityName: "Pune", status, url,
    demand: { impressions, clicks: 1, queries: impressions ? [{ query: "seo pune", impressions }] : [] },
  });

  it("local: gaps at or above the demand threshold, drafts cheaper, non-indexable pages always", () => {
    expect(fromLocal([cell("gap", 50)], 50)[0]).toMatchObject({ fingerprint: "local:gap:s:c", type: "local-gap", title: "No SEO page for Pune", query: "seo pune", impact: 50, severity: "LOW", effort: "HIGH" });
    expect(fromLocal([cell("gap", 49)], 50)).toEqual([]);
    expect(fromLocal([cell("gap", 200)], 50)[0]?.severity).toBe("MEDIUM");
    expect(fromLocal([cell("gap", 1000)], 50)[0]?.severity).toBe("HIGH");
    expect(fromLocal([cell("draft", 60)], 50)[0]).toMatchObject({ effort: "MEDIUM", evidence: expect.objectContaining({ cmsDraft: true }) });
    expect(fromLocal([cell("not-indexable", 0, "https://e.com/seo-pune")], 50)[0]).toMatchObject({ fingerprint: "local:not-indexable:s:c", url: "https://e.com/seo-pune", title: expect.stringContaining("/seo-pune"), severity: "MEDIUM", effort: "LOW" });
    expect(fromLocal([cell("not-indexable", 0, null), cell("covered", 900), cell("not-crawled", 900)], 50)).toEqual([]);
  });

  it("NAP: listings always, the site only with a crawl, schema mismatches grouped by field", () => {
    const base = { hasCrawl: true, hasAddress: true, schemaPages: 2, schemaMismatches: [], incompletePages: [], phoneOnSite: true, listings: [] };
    expect(fromNap(base)).toEqual([]);
    const listing = { id: "L1", name: "Pune", mismatches: [{ field: "name", expected: "A", found: "B" }, { field: "phone", expected: "1", found: "2" }] };
    expect(fromNap({ ...base, listings: [listing] }).map((c) => [c.fingerprint, c.severity])).toEqual([["nap:listing:L1:name", "MEDIUM"], ["nap:listing:L1:phone", "HIGH"]]);
    const site = {
      ...base,
      schemaPages: 0,
      schemaMismatches: [
        { url: "u1", mismatches: [{ field: "phone", expected: "1", found: "2" }] },
        { url: "u2", mismatches: [{ field: "phone", expected: "1", found: "3" }, { field: "postalCode", expected: "1", found: "2" }] },
      ],
      incompletePages: ["u1"],
      phoneOnSite: false,
    };
    const found = fromNap(site);
    expect(found.map((c) => c.fingerprint)).toEqual(["nap:schema:phone", "nap:schema:postalCode", "nap:phone-missing", "nap:schema-missing", "nap:schema-incomplete"]);
    expect(found[0]).toMatchObject({ impact: 2, title: expect.stringContaining("(2 pages)"), evidence: expect.objectContaining({ pages: ["u1", "u2"] }) });
    expect(found[1]?.title).toContain("(1 page)");
    expect(fromNap({ ...site, hasCrawl: false, listings: [listing] }).map((c) => c.source + c.type)).toEqual(["NAPnap-listing", "NAPnap-listing"]);
    expect(fromNap({ ...site, hasAddress: false }).map((c) => c.fingerprint)).not.toContain("nap:schema-missing");
    expect(fromNap({ ...site, phoneOnSite: null }).map((c) => c.fingerprint)).not.toContain("nap:phone-missing");
  });

  it("reviews: unanswered (high with a low rating) and quiet listings", () => {
    const options = { quietDays: 60, unansweredDays: 30, lowRating: 3 };
    const found = fromReviews([{ id: "a", name: "Pune", unanswered: 2, unansweredLow: 1, daysSinceLast: 60 }, { id: "b", name: "Mumbai", unanswered: 1, unansweredLow: 0, daysSinceLast: 59 }, { id: "c", name: "Nagpur", unanswered: 0, unansweredLow: 0, daysSinceLast: null }], options);
    expect(found.map((c) => [c.fingerprint, c.severity, c.impact, c.impactUnit])).toEqual([
      ["reviews:unanswered:a", "HIGH", 2, "reviews"],
      ["reviews:quiet:a", "LOW", 60, "days"],
      ["reviews:unanswered:b", "MEDIUM", 1, "reviews"],
    ]);
    expect(found[0]?.title).toBe("2 unanswered reviews from the last 30 days: Pune");
    expect(found[2]?.title).toBe("1 unanswered review from the last 30 days: Mumbai");
  });

  it("international: one per country without a version, severity from clicks", () => {
    expect(fromInternational([{ country: "AE", name: "United Arab Emirates", clicks: 12, impressions: 300, share: 0.083 }])).toEqual([
      expect.objectContaining({ fingerprint: "international:country:AE", title: "United Arab Emirates sends 8% of clicks but has no version of its own", impact: 12, impactUnit: "clicks", severity: "MEDIUM", effort: "HIGH" }),
    ]);
  });
});

describe("reconcile", () => {
  const candidate = (fingerprint: string, impact = 10, source: Candidate["source"] = "CONTENT"): Candidate => ({
    fingerprint, source, type: "t", title: fingerprint, url: null, query: null, evidence: {}, impact, impactUnit: "clicks", severity: "MEDIUM", effort: "LOW",
  });
  const stored = (fingerprint: string, status: Stored["status"], extra: Partial<Stored> = {}): Stored => ({ id: `id-${fingerprint}`, fingerprint, source: "CONTENT", status, impact: 10, dismissedImpact: null, ...extra });
  const ran = new Set<Candidate["source"]>(["CONTENT", "KEYWORDS"]);

  it("creates new findings and refreshes open ones without changing status", () => {
    const plan = reconcile([stored("a", "OPEN"), stored("b", "TASK_CREATED")], [candidate("a"), candidate("b"), candidate("c")], ran);
    expect(plan.create.map((c) => c.fingerprint)).toEqual(["c"]);
    expect(plan.refresh.map((r) => r.id)).toEqual(["id-a", "id-b"]);
    expect(plan.resolve).toEqual([]);
  });

  it("resolves what is no longer found — only for sources that ran", () => {
    const plan = reconcile(
      [stored("gone", "OPEN"), stored("tasked", "TASK_CREATED"), stored("dismissed", "DISMISSED"), stored("unknown", "OPEN", { source: "TECHNICAL" })],
      [],
      ran,
    );
    expect(plan.resolve.sort()).toEqual(["id-gone", "id-tasked"]);
  });

  it("reopens resolved and done findings that come back", () => {
    const plan = reconcile([stored("r", "RESOLVED"), stored("d", "DONE")], [candidate("r"), candidate("d")], ran);
    expect(plan.reopen.map((r) => r.id).sort()).toEqual(["id-d", "id-r"]);
  });

  it("keeps dismissed findings dismissed until their impact doubles", () => {
    const rows = [stored("x", "DISMISSED", { dismissedImpact: 10 })];
    expect(reconcile(rows, [candidate("x", 19)], ran).reopen).toHaveLength(0);
    expect(reconcile(rows, [candidate("x", 19)], ran).refresh).toHaveLength(1);
    expect(reconcile(rows, [candidate("x", 20)], ran).reopen).toHaveLength(1);
    // A zero-impact dismissal needs at least 2 to come back.
    expect(reconcile([stored("z", "DISMISSED", { dismissedImpact: 0, impact: 0 })], [candidate("z", 1)], ran).reopen).toHaveLength(0);
    expect(reconcile([stored("z", "DISMISSED", { dismissedImpact: 0, impact: 0 })], [candidate("z", 2)], ran).reopen).toHaveLength(1);
  });

  it("ignores a duplicate candidate fingerprint", () => {
    expect(reconcile([], [candidate("a"), candidate("a")], ran).create).toHaveLength(1);
  });
});
