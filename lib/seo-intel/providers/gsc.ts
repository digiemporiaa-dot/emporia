import type { GscQueryInput, GscRawRow, GscSite, SearchConsoleProvider } from "@/lib/seo-intel/providers/types";
import { SeoAccessError, SeoCredentialsError, SeoProviderError, SeoRateLimitError } from "@/lib/seo-intel/providers/errors";

/**
 * Google Search Console, through its documented REST API (Webmasters v3).
 *
 * Read-only: it lists sites and runs Search Analytics queries. The access
 * token comes from a callback, so the same adapter serves an OAuth connection
 * (whose token the service refreshes and stores) and a service account
 * (whose token is minted on demand) — the adapter never sees how.
 *
 * Every failure is mapped to a typed error; nothing here returns an empty
 * list to mean "it went wrong".
 */

export const GSC_API = "https://www.googleapis.com/webmasters/v3";
/** Google's hard limit per Search Analytics request. */
export const GSC_MAX_ROWS = 25_000;
/** Read-only Search Console access — the only scope this module needs. */
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const PERMISSION_LEVELS = new Set(["siteOwner", "siteFullUser", "siteRestrictedUser", "siteUnverifiedUser"]);

async function call(fetcher: Fetch, token: string, url: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, accept: "application/json" },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SeoProviderError("Search Console could not be reached. The next sync will try again.");
  }

  if (response.status === 401) {
    throw new SeoCredentialsError("Google no longer accepts this Search Console connection. Reconnect it.");
  }
  if (response.status === 403) {
    throw new SeoAccessError(
      "This Google account cannot read that Search Console property. Check it has at least restricted access, or connect with an account that does.",
    );
  }
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after"));
    throw new SeoRateLimitError(Number.isFinite(retry) && retry > 0 ? retry : 60);
  }
  if (!response.ok) {
    throw new SeoProviderError(`Search Console answered ${response.status}. The next sync will try again.`);
  }

  try {
    return await response.json();
  } catch {
    throw new SeoProviderError("Search Console sent an answer that could not be read.");
  }
}

export class GoogleSearchConsole implements SearchConsoleProvider {
  constructor(
    private readonly token: () => Promise<string>,
    private readonly fetcher: Fetch = fetch,
    private readonly api: string = GSC_API,
  ) {}

  async listSites(): Promise<GscSite[]> {
    const body = (await call(this.fetcher, await this.token(), `${this.api}/sites`)) as { siteEntry?: unknown };
    const entries = Array.isArray(body?.siteEntry) ? body.siteEntry : [];
    return entries
      .filter(
        (entry): entry is GscSite =>
          !!entry &&
          typeof (entry as GscSite).siteUrl === "string" &&
          typeof (entry as GscSite).permissionLevel === "string" &&
          PERMISSION_LEVELS.has((entry as GscSite).permissionLevel),
      )
      .map((entry) => ({ siteUrl: entry.siteUrl, permissionLevel: entry.permissionLevel }));
  }

  async query(input: GscQueryInput): Promise<GscRawRow[]> {
    const url = `${this.api}/sites/${encodeURIComponent(input.siteUrl)}/searchAnalytics/query`;
    const body = (await call(this.fetcher, await this.token(), url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        startDate: input.startDate,
        endDate: input.endDate,
        dimensions: input.dimensions,
        rowLimit: Math.min(Math.max(1, input.rowLimit), GSC_MAX_ROWS),
        startRow: input.startRow ?? 0,
        // "all" includes the freshest, not-yet-final days; the sync re-reads
        // the recent window every run, so they converge on the final numbers.
        dataState: "all",
        type: "web",
      }),
    })) as { rows?: unknown };
    return Array.isArray(body?.rows) ? (body.rows as GscRawRow[]) : [];
  }
}

/**
 * Every row of a query, page by page, up to `cap`. Google returns at most
 * 25,000 rows a request and signals the end with a short page.
 */
export async function queryAll(
  provider: SearchConsoleProvider,
  input: Omit<GscQueryInput, "rowLimit" | "startRow">,
  cap: number,
): Promise<{ rows: GscRawRow[]; truncated: boolean }> {
  const rows: GscRawRow[] = [];
  while (rows.length < cap) {
    const limit = Math.min(GSC_MAX_ROWS, cap - rows.length);
    const page = await provider.query({ ...input, rowLimit: limit, startRow: rows.length });
    rows.push(...page);
    if (page.length < limit) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
