import { RULES, type RuleKey } from "@/lib/seo-intel/engine/technical";
import type { Finding } from "@/lib/seo-intel/engine/content";
import type { Opportunity as KeywordOpportunity } from "@/lib/seo-intel/engine/rankings";
import type { ChangeInsight } from "@/lib/seo-intel/engine/changes";

/**
 * The opportunity engine (Phase 10). Pure.
 *
 * Every rule built so far proposes candidates; each carries a fingerprint that
 * stays the same while it is the same finding, so the daily detector updates
 * rather than duplicates. `reconcile` decides, against what is stored, what to
 * create, refresh, resolve and reopen.
 */

export type Source = "KEYWORDS" | "CONTENT" | "TECHNICAL" | "INDEXATION" | "LINKS" | "CHANGES";
export type Severity = "HIGH" | "MEDIUM" | "LOW";
export type Effort = "LOW" | "MEDIUM" | "HIGH";
export type Status = "OPEN" | "TASK_CREATED" | "DONE" | "DISMISSED" | "RESOLVED";

export type Candidate = {
  fingerprint: string;
  source: Source;
  type: string;
  title: string;
  url: string | null;
  query: string | null;
  evidence: Record<string, unknown>;
  impact: number;
  impactUnit: "clicks" | "impressions" | "pages" | "links" | "alert";
  severity: Severity;
  effort: Effort;
};

/** Click impact → severity. Documented on the Command Center screen. */
export const CLICK_SEVERITY = { high: 50, medium: 10 } as const;
export function clickSeverity(clicks: number): Severity {
  return clicks >= CLICK_SEVERITY.high ? "HIGH" : clicks >= CLICK_SEVERITY.medium ? "MEDIUM" : "LOW";
}

const path = (url: string) => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
};

export function fromKeywords(opportunities: readonly (KeywordOpportunity & { trackedId?: string | null })[], cap: number): Candidate[] {
  return [...opportunities]
    .sort((a, b) => (b.extraClicks ?? -1) - (a.extraClicks ?? -1) || b.impressions - a.impressions)
    .slice(0, cap)
    .map((o) => ({
      fingerprint: `keywords:${o.query}`,
      source: "KEYWORDS",
      type: o.band === "near-top" ? "keyword-near-top" : "keyword-page-two",
      title: o.band === "near-top" ? `Push “${o.query}” into the top 3` : `Bring “${o.query}” onto page one`,
      url: null,
      query: o.query,
      evidence: { position: o.position, impressions: o.impressions, clicks: o.clicks, extraClicks: o.extraClicks, tracked: !!o.trackedId },
      impact: o.extraClicks ?? 0,
      impactUnit: "clicks",
      severity: o.extraClicks === null ? "LOW" : clickSeverity(o.extraClicks),
      effort: o.band === "near-top" ? "MEDIUM" : "HIGH",
    }));
}

const CONTENT_META = {
  decaying: { title: "Decaying page", effort: "MEDIUM" },
  refresh: { title: "Page needs a refresh", effort: "MEDIUM" },
  "low-ctr": { title: "Rewrite title and description", effort: "LOW" },
  potential: { title: "High-potential page", effort: "MEDIUM" },
  cannibalisation: { title: "Pages competing for one query", effort: "MEDIUM" },
} as const satisfies Record<Finding["type"], { title: string; effort: Effort }>;

export function fromContent(findings: readonly Finding[], capPerType: number): Candidate[] {
  const counts = new Map<string, number>();
  const out: Candidate[] = [];
  for (const finding of findings) {
    const seen = counts.get(finding.type) ?? 0;
    if (seen >= capPerType) continue;
    counts.set(finding.type, seen + 1);
    const meta = CONTENT_META[finding.type];
    const key = finding.type === "cannibalisation" ? finding.query : finding.url;
    const { type, impact, ...rest } = finding;
    out.push({
      fingerprint: `content:${type}:${key}`,
      source: "CONTENT",
      type,
      title: finding.type === "cannibalisation" ? `${meta.title}: “${finding.query}”` : `${meta.title}: ${path(finding.url)}`,
      url: finding.type === "cannibalisation" ? null : finding.url,
      query: finding.type === "cannibalisation" ? finding.query : null,
      evidence: rest as Record<string, unknown>,
      impact,
      // Cannibalisation is measured in impressions on the weaker pages; ten
      // impressions are weighed like one click (500+ high, 100+ medium).
      impactUnit: finding.type === "cannibalisation" ? "impressions" : "clicks",
      severity: clickSeverity(finding.type === "cannibalisation" ? Math.round(impact / 10) : impact),
      effort: meta.effort,
    });
  }
  return out;
}

export type TechnicalGroup = { rule: string; severity: "CRITICAL" | "WARNING" | "NOTICE"; count: number; sample: string[] };

/** One candidate per technical rule with critical or warning findings; notices stay on the Technical SEO tab. */
export function fromTechnical(groups: readonly TechnicalGroup[]): Candidate[] {
  return groups
    .filter((group) => group.severity !== "NOTICE" && group.count > 0)
    .map((group) => {
      const rule = group.rule in RULES ? RULES[group.rule as RuleKey] : null;
      return {
        fingerprint: `technical:${group.rule}`,
        source: "TECHNICAL",
        type: `technical:${group.rule}`,
        title: `${rule?.title ?? group.rule} (${group.count} page${group.count === 1 ? "" : "s"})`,
        url: null,
        query: null,
        evidence: { rule: group.rule, count: group.count, sample: group.sample.slice(0, 5) },
        impact: group.count,
        impactUnit: "pages",
        severity: group.severity === "CRITICAL" ? "HIGH" : "MEDIUM",
        effort: "MEDIUM",
      };
    });
}

export type IndexationGroup = { conflict: "indexable-not-indexed" | "not-indexable-but-indexed" | "canonical-mismatch"; urls: string[] };

const INDEXATION_META = {
  "indexable-not-indexed": { title: "Indexable pages Google has not indexed", severity: "HIGH" },
  "not-indexable-but-indexed": { title: "Pages in Google's index that should not be", severity: "MEDIUM" },
  "canonical-mismatch": { title: "Google chose a different canonical", severity: "MEDIUM" },
} as const;

export function fromIndexation(groups: readonly IndexationGroup[]): Candidate[] {
  return groups
    .filter((group) => group.urls.length > 0)
    .map((group) => ({
      fingerprint: `indexation:${group.conflict}`,
      source: "INDEXATION",
      type: group.conflict,
      title: `${INDEXATION_META[group.conflict].title} (${group.urls.length})`,
      url: null,
      query: null,
      evidence: { count: group.urls.length, sample: group.urls.slice(0, 5) },
      impact: group.urls.length,
      impactUnit: "pages",
      severity: INDEXATION_META[group.conflict].severity,
      effort: "MEDIUM",
    }));
}

export type LinkGroup = { target: string; query: string; position: number; impressions: number; sources: string[] };

export function fromLinks(groups: readonly LinkGroup[]): Candidate[] {
  return groups.map((group) => ({
    fingerprint: `links:${group.target}:${group.query}`,
    source: "LINKS",
    type: "internal-link",
    title: `Link to ${path(group.target)} with “${group.query}”`,
    url: group.target,
    query: group.query,
    evidence: { position: group.position, impressions: group.impressions, sources: group.sources.slice(0, 5) },
    impact: group.sources.length,
    impactUnit: "links",
    severity: "LOW",
    effort: "LOW",
  }));
}

/** Drops from What changed that need looking into: down, and high or medium. */
export function fromChanges(insights: readonly ChangeInsight[]): Candidate[] {
  return insights
    .filter((insight) => insight.direction === "down" && insight.severity !== "low")
    .map((insight) => ({
      fingerprint: `changes:${insight.key}`,
      source: "CHANGES",
      type: `change:${insight.key.split(":")[0]}`,
      title: insight.title,
      url: insight.entity.type === "page" ? (insight.entity.keys[0] ?? null) : null,
      query: insight.entity.type === "query" ? (insight.entity.keys[0] ?? null) : null,
      evidence: { range: insight.range, entity: insight.entity, view: insight.view },
      impact: 0,
      impactUnit: "alert",
      severity: insight.severity === "high" ? "HIGH" : "MEDIUM",
      effort: "MEDIUM",
    }));
}

// ---------------------------------------------------------------------------
// Reconciling with what is stored
// ---------------------------------------------------------------------------

export type Stored = { id: string; fingerprint: string; source: Source; status: Status; impact: number; dismissedImpact: number | null };

export type Plan = {
  create: Candidate[];
  /** Still true: refresh evidence, keep status. */
  refresh: { id: string; candidate: Candidate }[];
  /** Back after resolving or being done, or dismissed and now at least twice as big. */
  reopen: { id: string; candidate: Candidate }[];
  /** No longer found by a source that ran. */
  resolve: string[];
};

/**
 * @param ran Sources that were computed this time. Stored opportunities from a
 *            source that could not run (no data, an outage) are left alone —
 *            not knowing is not the same as fixed.
 */
export function reconcile(stored: readonly Stored[], candidates: readonly Candidate[], ran: ReadonlySet<Source>): Plan {
  const byPrint = new Map(stored.map((row) => [row.fingerprint, row]));
  const found = new Set<string>();
  const plan: Plan = { create: [], refresh: [], reopen: [], resolve: [] };

  for (const candidate of candidates) {
    if (found.has(candidate.fingerprint)) continue;
    found.add(candidate.fingerprint);
    const row = byPrint.get(candidate.fingerprint);
    if (!row) {
      plan.create.push(candidate);
      continue;
    }
    switch (row.status) {
      case "OPEN":
      case "TASK_CREATED":
        plan.refresh.push({ id: row.id, candidate });
        break;
      case "RESOLVED":
      case "DONE":
        plan.reopen.push({ id: row.id, candidate });
        break;
      case "DISMISSED": {
        const doubled = candidate.impact >= 2 * Math.max(1, row.dismissedImpact ?? row.impact);
        (doubled ? plan.reopen : plan.refresh).push({ id: row.id, candidate });
        break;
      }
    }
  }

  for (const row of stored) {
    if (found.has(row.fingerprint) || !ran.has(row.source)) continue;
    if (row.status === "OPEN" || row.status === "TASK_CREATED") plan.resolve.push(row.id);
  }
  return plan;
}
