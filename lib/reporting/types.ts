/**
 * The reporting provider contract.
 *
 * Phase 14 defines the boundary; no provider is implemented yet. Every campaign
 * metric in the database therefore arrives one of two honest ways: typed in by
 * staff, or imported from a file they exported themselves. Both are recorded
 * with `MetricSource` so provenance is auditable rather than assumed
 * (CLAUDE.md 2 rule 5, 16).
 *
 * When a provider is implemented it fills in `fetchDailyMetrics` and writes
 * rows with `source: IMPORT`. Nothing above this file changes.
 *
 * Money crosses this boundary as fixed-precision strings, never JS numbers
 * (CLAUDE.md 2 rule 1). Counts are integers, which is what they are.
 */

export const REPORTING_PROVIDERS = [
  "GOOGLE_ADS",
  "META_ADS",
  "GA4",
  "SEARCH_CONSOLE",
] as const;

export type ReportingProviderName = (typeof REPORTING_PROVIDERS)[number];

export const REPORTING_PROVIDER_LABEL: Record<ReportingProviderName, string> = {
  GOOGLE_ADS: "Google Ads",
  META_ADS: "Meta Ads",
  GA4: "Google Analytics 4",
  SEARCH_CONSOLE: "Search Console",
};

/** One day of performance, as a provider reports it. */
export type DailyMetric = {
  /** The day the numbers belong to, at UTC midnight. */
  date: Date;
  impressions: number;
  clicks: number;
  conversions: number;
  /** Fixed-precision string. */
  spend: string;
  /** Null when the provider cannot attribute revenue — never a zero. */
  revenue: string | null;
};

export interface ReportingProvider {
  readonly name: ReportingProviderName;
  readonly configured: boolean;

  /**
   * Daily rows for one of the provider's own campaigns, over a half-open
   * range. `externalId` is the provider's campaign identifier, which is why a
   * Campaign needs one before it can be synced.
   */
  fetchDailyMetrics(input: {
    externalId: string;
    from: Date;
    to: Date;
  }): Promise<DailyMetric[]>;
}
