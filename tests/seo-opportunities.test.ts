import { describe, expect, it } from "vitest";
import {
  clickSeverity,
  fromChanges,
  fromContent,
  fromIndexation,
  fromKeywords,
  fromLinks,
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
