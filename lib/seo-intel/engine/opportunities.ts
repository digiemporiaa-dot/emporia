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

export type Source = "KEYWORDS" | "CONTENT" | "TECHNICAL" | "INDEXATION" | "LINKS" | "CHANGES" | "LOCAL" | "NAP" | "REVIEWS" | "INTERNATIONAL" | "ANALYTICS";
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
  impactUnit: "clicks" | "impressions" | "pages" | "links" | "alert" | "reviews" | "days" | "sessions";
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

// ---------------------------------------------------------------------------
// Local and international (Phase 8)
// ---------------------------------------------------------------------------

/** Impression demand → severity for local gaps. */
export const DEMAND_SEVERITY = { high: 1_000, medium: 200 } as const;
const demandSeverity = (impressions: number): Severity =>
  impressions >= DEMAND_SEVERITY.high ? "HIGH" : impressions >= DEMAND_SEVERITY.medium ? "MEDIUM" : "LOW";

export type LocalCell = {
  serviceId: string;
  serviceName: string;
  cityId: string;
  cityName: string;
  status: "covered" | "not-indexable" | "not-crawled" | "draft" | "gap";
  url: string | null;
  demand: { impressions: number; clicks: number; queries: { query: string; impressions: number }[] };
};

/** Gaps with real demand, and matched pages Google cannot index. */
export function fromLocal(cells: readonly LocalCell[], minImpressions: number): Candidate[] {
  const out: Candidate[] = [];
  for (const cell of cells) {
    const evidence = { service: cell.serviceName, city: cell.cityName, demand: cell.demand.impressions, queries: cell.demand.queries.slice(0, 5) };
    if ((cell.status === "gap" || cell.status === "draft") && cell.demand.impressions >= minImpressions) {
      out.push({
        fingerprint: `local:gap:${cell.serviceId}:${cell.cityId}`,
        source: "LOCAL",
        type: "local-gap",
        title: `No ${cell.serviceName} page for ${cell.cityName}`,
        url: null,
        query: cell.demand.queries[0]?.query ?? null,
        evidence: { ...evidence, cmsDraft: cell.status === "draft" },
        impact: cell.demand.impressions,
        impactUnit: "impressions",
        severity: demandSeverity(cell.demand.impressions),
        effort: cell.status === "draft" ? "MEDIUM" : "HIGH",
      });
    } else if (cell.status === "not-indexable" && cell.url) {
      out.push({
        fingerprint: `local:not-indexable:${cell.serviceId}:${cell.cityId}`,
        source: "LOCAL",
        type: "local-not-indexable",
        title: `${cell.serviceName} page for ${cell.cityName} cannot be indexed: ${path(cell.url)}`,
        url: cell.url,
        query: null,
        evidence,
        impact: cell.demand.impressions,
        impactUnit: "impressions",
        severity: "MEDIUM",
        effort: "LOW",
      });
    }
  }
  return out;
}

export type NapInput = {
  hasCrawl: boolean;
  hasAddress: boolean;
  schemaPages: number;
  schemaMismatches: { url: string; mismatches: { field: string; expected: string; found: string }[] }[];
  incompletePages: string[];
  phoneOnSite: boolean | null;
  listings: { id: string; name: string; mismatches: { field: string; expected: string; found: string }[] }[];
};

const NAP_FIELD: Record<string, string> = { name: "name", phone: "phone", street: "street address", locality: "city", postalCode: "postal code" };

/** Disagreements with the business profile, and missing local structured data. */
export function fromNap(input: NapInput): Candidate[] {
  const out: Candidate[] = [];
  for (const listing of input.listings) {
    for (const mismatch of listing.mismatches) {
      out.push({
        fingerprint: `nap:listing:${listing.id}:${mismatch.field}`,
        source: "NAP",
        type: "nap-listing",
        title: `Google listing ${NAP_FIELD[mismatch.field] ?? mismatch.field} differs: ${listing.name}`,
        url: null,
        query: null,
        evidence: { listing: listing.name, ...mismatch },
        impact: 1,
        impactUnit: "alert",
        severity: mismatch.field === "name" ? "MEDIUM" : "HIGH",
        effort: "LOW",
      });
    }
  }
  if (!input.hasCrawl) return out;

  const byField = new Map<string, { pages: string[]; example: { expected: string; found: string } }>();
  for (const page of input.schemaMismatches) {
    for (const mismatch of page.mismatches) {
      const entry = byField.get(mismatch.field) ?? { pages: [], example: { expected: mismatch.expected, found: mismatch.found } };
      if (!entry.pages.includes(page.url)) entry.pages.push(page.url);
      byField.set(mismatch.field, entry);
    }
  }
  for (const [field, entry] of byField) {
    out.push({
      fingerprint: `nap:schema:${field}`,
      source: "NAP",
      type: "nap-schema",
      title: `Structured data ${NAP_FIELD[field] ?? field} differs from the business profile (${entry.pages.length} ${entry.pages.length === 1 ? "page" : "pages"})`,
      url: entry.pages[0] ?? null,
      query: null,
      evidence: { field, ...entry.example, pages: entry.pages.slice(0, 10) },
      impact: entry.pages.length,
      impactUnit: "pages",
      severity: "MEDIUM",
      effort: "LOW",
    });
  }
  if (input.phoneOnSite === false) {
    out.push({ fingerprint: "nap:phone-missing", source: "NAP", type: "nap-phone-missing", title: "The business phone number is not on the website", url: null, query: null, evidence: {}, impact: 1, impactUnit: "alert", severity: "MEDIUM", effort: "LOW" });
  }
  if (input.hasAddress && input.schemaPages === 0) {
    out.push({ fingerprint: "nap:schema-missing", source: "NAP", type: "nap-schema-missing", title: "No LocalBusiness structured data on the website", url: null, query: null, evidence: {}, impact: 1, impactUnit: "alert", severity: "MEDIUM", effort: "LOW" });
  }
  if (input.incompletePages.length) {
    out.push({
      fingerprint: "nap:schema-incomplete",
      source: "NAP",
      type: "nap-schema-incomplete",
      title: `LocalBusiness structured data is missing required fields (${input.incompletePages.length} ${input.incompletePages.length === 1 ? "page" : "pages"})`,
      url: input.incompletePages[0] ?? null,
      query: null,
      evidence: { pages: input.incompletePages.slice(0, 10) },
      impact: input.incompletePages.length,
      impactUnit: "pages",
      severity: "LOW",
      effort: "LOW",
    });
  }
  return out;
}

export type ReviewInput = { id: string; name: string; unanswered: number; unansweredLow: number; daysSinceLast: number | null };

export function fromReviews(locations: readonly ReviewInput[], options: { quietDays: number; unansweredDays: number; lowRating: number }): Candidate[] {
  const out: Candidate[] = [];
  for (const location of locations) {
    if (location.unanswered > 0) {
      out.push({
        fingerprint: `reviews:unanswered:${location.id}`,
        source: "REVIEWS",
        type: "reviews-unanswered",
        title: `${location.unanswered} unanswered ${location.unanswered === 1 ? "review" : "reviews"} from the last ${options.unansweredDays} days: ${location.name}`,
        url: null,
        query: null,
        evidence: { location: location.name, unanswered: location.unanswered, lowRated: location.unansweredLow, lowRating: options.lowRating },
        impact: location.unanswered,
        impactUnit: "reviews",
        severity: location.unansweredLow > 0 ? "HIGH" : "MEDIUM",
        effort: "LOW",
      });
    }
    if (location.daysSinceLast !== null && location.daysSinceLast >= options.quietDays) {
      out.push({
        fingerprint: `reviews:quiet:${location.id}`,
        source: "REVIEWS",
        type: "reviews-quiet",
        title: `No new Google review for ${location.daysSinceLast} days: ${location.name}`,
        url: null,
        query: null,
        evidence: { location: location.name, days: location.daysSinceLast },
        impact: location.daysSinceLast,
        impactUnit: "days",
        severity: "LOW",
        effort: "MEDIUM",
      });
    }
  }
  return out;
}

export function fromInternational(missing: readonly { country: string; name: string; clicks: number; impressions: number; share: number }[]): Candidate[] {
  return missing.map((row) => ({
    fingerprint: `international:country:${row.country}`,
    source: "INTERNATIONAL" as const,
    type: "international-missing-version",
    title: `${row.name} sends ${Math.round(row.share * 100)}% of clicks but has no version of its own`,
    url: null,
    query: null,
    evidence: { country: row.country, clicks: row.clicks, impressions: row.impressions, share: row.share },
    impact: row.clicks,
    impactUnit: "clicks" as const,
    severity: clickSeverity(row.clicks),
    effort: "HIGH" as const,
  }));
}

/** Organic sessions → severity for low-converting pages. */
export const SESSION_SEVERITY = { high: 2_000, medium: 500 } as const;

export function fromAnalytics(pages: readonly { path: string; sessions: number; keyEvents: number; rate: number; siteRate: number }[]): Candidate[] {
  return pages.map((page) => ({
    fingerprint: `analytics:low-conversion:${page.path}`,
    source: "ANALYTICS" as const,
    type: "analytics-low-conversion",
    title: `Organic visitors rarely convert on ${page.path}`,
    url: null,
    query: null,
    evidence: { path: page.path, sessions: page.sessions, keyEvents: page.keyEvents, rate: page.rate, siteRate: page.siteRate },
    impact: page.sessions,
    impactUnit: "sessions" as const,
    severity: page.sessions >= SESSION_SEVERITY.high ? ("HIGH" as const) : page.sessions >= SESSION_SEVERITY.medium ? ("MEDIUM" as const) : ("LOW" as const),
    effort: "MEDIUM" as const,
  }));
}

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
