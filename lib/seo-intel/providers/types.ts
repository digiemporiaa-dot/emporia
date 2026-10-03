/**
 * The provider contracts SEO Intelligence depends on
 * (docs/SEO-INTELLIGENCE-PLAN.md, Part C).
 *
 * The engine and the services see only these shapes. A vendor sits behind
 * one implementation; swapping it changes one file. Rank, SERP and backlink
 * contracts arrive with the phases that use them.
 */

export type GscDimension = "date" | "query" | "page" | "country" | "device" | "searchAppearance";

/** One Search Console site the credentials can see. */
export type GscSite = {
  /** "sc-domain:example.com" or "https://www.example.com/". */
  siteUrl: string;
  /** "siteOwner", "siteFullUser", "siteRestrictedUser" or "siteUnverifiedUser". */
  permissionLevel: string;
};

export type GscQueryInput = {
  siteUrl: string;
  /** Inclusive, "YYYY-MM-DD", Pacific time — Search Console's own days. */
  startDate: string;
  endDate: string;
  dimensions: GscDimension[];
  /** Max 25,000 per request (Google's limit). */
  rowLimit: number;
  startRow?: number;
};

/** A row exactly as the API returns it; normalised before anything stores it. */
export type GscRawRow = {
  keys?: unknown;
  clicks?: unknown;
  impressions?: unknown;
  ctr?: unknown;
  position?: unknown;
};

export interface SearchConsoleProvider {
  listSites(): Promise<GscSite[]>;
  query(input: GscQueryInput): Promise<GscRawRow[]>;
}
