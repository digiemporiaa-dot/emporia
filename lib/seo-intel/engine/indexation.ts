/**
 * Indexation: what Google says about each URL (URL Inspection), set against
 * what the crawl found. Pure.
 */

export type Inspection = {
  verdict: string | null;
  coverageState: string | null;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  lastCrawlTime: Date | null;
  crawledAs: string | null;
  sitemaps: string[];
};

const str = (value: unknown, max = 500): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

/** Google's `inspectionResult` → the fields stored. Unknown shapes become nulls, never guesses. */
export function normalizeInspection(raw: unknown): Inspection {
  const result = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const index = result["indexStatusResult"] && typeof result["indexStatusResult"] === "object" ? (result["indexStatusResult"] as Record<string, unknown>) : {};
  const crawl = str(index["lastCrawlTime"]);
  const crawlDate = crawl ? new Date(crawl) : null;
  return {
    verdict: str(index["verdict"], 40),
    coverageState: str(index["coverageState"], 200),
    indexingState: str(index["indexingState"], 80),
    robotsTxtState: str(index["robotsTxtState"], 80),
    pageFetchState: str(index["pageFetchState"], 80),
    googleCanonical: str(index["googleCanonical"], 2_000),
    userCanonical: str(index["userCanonical"], 2_000),
    lastCrawlTime: crawlDate && !Number.isNaN(crawlDate.getTime()) ? crawlDate : null,
    crawledAs: str(index["crawledAs"], 40),
    sitemaps: Array.isArray(index["sitemap"]) ? (index["sitemap"] as unknown[]).map((s) => str(s, 2_000)).filter((s): s is string => !!s).slice(0, 20) : [],
  };
}

export type IndexBucket = "indexed" | "not-indexed" | "unknown-to-google" | "error" | "not-inspected";

export const BUCKET_LABEL: Record<IndexBucket, string> = {
  indexed: "Indexed",
  "not-indexed": "Not indexed",
  "unknown-to-google": "Unknown to Google",
  error: "Could not inspect",
  "not-inspected": "Not inspected yet",
};

/**
 * Google's verdict PASS means indexed. Otherwise its coverage wording decides:
 * "URL is unknown to Google" is its own bucket, everything else not indexed.
 */
export function bucketOf(inspection: { verdict: string | null; coverageState: string | null; error?: string | null } | null): IndexBucket {
  if (!inspection) return "not-inspected";
  if (inspection.error) return "error";
  if (inspection.verdict === "PASS") return "indexed";
  if (inspection.coverageState && /unknown to google/i.test(inspection.coverageState)) return "unknown-to-google";
  if (!inspection.verdict && !inspection.coverageState) return "error";
  return "not-indexed";
}

export type SampleCandidate = { url: string; inSitemap: boolean; indexable: boolean };

/**
 * Which URLs to inspect next, within today's remaining budget: never-inspected
 * sitemap URLs, then never-inspected indexable pages, then the stalest
 * inspections older than `staleAfterDays`.
 */
export function pickInspectionSample(
  candidates: SampleCandidate[],
  inspectedAt: Map<string, Date>,
  budget: number,
  now: Date,
  staleAfterDays = 14,
): string[] {
  if (budget <= 0) return [];
  const staleBefore = now.getTime() - staleAfterDays * 86_400_000;
  const fresh = candidates.filter((candidate) => !inspectedAt.has(candidate.url));
  const tier1 = fresh.filter((candidate) => candidate.inSitemap);
  const tier2 = fresh.filter((candidate) => !candidate.inSitemap && candidate.indexable);
  const stale = candidates
    .filter((candidate) => {
      const at = inspectedAt.get(candidate.url);
      return at !== undefined && at.getTime() < staleBefore && (candidate.inSitemap || candidate.indexable);
    })
    .sort((a, b) => (inspectedAt.get(a.url) as Date).getTime() - (inspectedAt.get(b.url) as Date).getTime());
  return [...tier1, ...tier2, ...stale].slice(0, budget).map((candidate) => candidate.url);
}

export type Conflict = "indexable-not-indexed" | "not-indexable-but-indexed" | "canonical-mismatch";

export const CONFLICT_LABEL: Record<Conflict, string> = {
  "indexable-not-indexed": "Indexable, but Google has not indexed it",
  "not-indexable-but-indexed": "Noindex or canonicalised here, but still in Google's index",
  "canonical-mismatch": "Google chose a different canonical",
};

/** Where the crawl and Google disagree about a URL. */
export function conflictsOf(
  crawl: { indexable: boolean | null },
  inspection: { verdict: string | null; coverageState: string | null; googleCanonical: string | null; userCanonical: string | null; error?: string | null } | null,
): Conflict[] {
  if (!inspection || inspection.error) return [];
  const bucket = bucketOf(inspection);
  const out: Conflict[] = [];
  if (crawl.indexable === true && (bucket === "not-indexed" || bucket === "unknown-to-google")) out.push("indexable-not-indexed");
  if (crawl.indexable === false && bucket === "indexed") out.push("not-indexable-but-indexed");
  if (inspection.googleCanonical && inspection.userCanonical && inspection.googleCanonical !== inspection.userCanonical) out.push("canonical-mismatch");
  return out;
}
