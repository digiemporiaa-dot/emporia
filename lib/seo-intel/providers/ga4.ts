import { SeoAccessError, SeoCredentialsError, SeoProviderError, SeoRateLimitError } from "@/lib/seo-intel/providers/errors";

/**
 * Google Analytics 4, through its documented REST APIs (Phase 9).
 *
 * The Admin API (v1beta) lists the properties an account can see, with their
 * currency, time zone and web data streams; the Data API (v1beta) runs
 * reports. Read-only. Like the Search Console adapter, the access token comes
 * from a callback, so OAuth and service-account connections share it.
 *
 * Both APIs must be enabled in the Google Cloud project. When one is not,
 * Google answers 403 SERVICE_DISABLED, which is reported in those words rather
 * than as a permissions problem.
 */

export const GA4_DATA_API = "https://analyticsdata.googleapis.com/v1beta";
export const GA4_ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";
/** Read-only Analytics access — the only scope this module needs. */
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
/** Google's largest report page. */
export const GA4_MAX_ROWS = 250_000;
const ADMIN_PAGES = 20;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type Ga4PropertySummary = { property: string; displayName: string; account: string; accountName: string };
export type Ga4PropertyDetail = { property: string; displayName: string; currencyCode: string | null; timeZone: string | null };
export type Ga4WebStream = { defaultUri: string };

export type Ga4ReportInput = {
  property: string;
  startDate: string;
  endDate: string;
  dimensions: string[];
  metrics: string[];
  /** Exact match on one dimension, e.g. channel = "Organic Search". */
  filter?: { field: string; value: string };
  orderBySessions?: boolean;
  limit: number;
  offset?: number;
};

export type Ga4RawReport = {
  dimensionHeaders?: { name?: unknown }[];
  metricHeaders?: { name?: unknown }[];
  rows?: { dimensionValues?: { value?: unknown }[]; metricValues?: { value?: unknown }[] }[];
  rowCount?: unknown;
};

export interface AnalyticsProvider {
  listProperties(): Promise<Ga4PropertySummary[]>;
  getProperty(property: string): Promise<Ga4PropertyDetail>;
  listWebStreams(property: string): Promise<Ga4WebStream[]>;
  runReport(input: Ga4ReportInput): Promise<Ga4RawReport>;
}

export const PROPERTY_ID = /^properties\/\d+$/;

type Api = "Google Analytics Admin API" | "Google Analytics Data API";
const ADMIN: Api = "Google Analytics Admin API";
const DATA: Api = "Google Analytics Data API";

async function call(fetcher: Fetch, token: string, api: Api, url: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, accept: "application/json" },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SeoProviderError("Google Analytics could not be reached. The next sync will try again.");
  }

  if (response.status === 401) throw new SeoCredentialsError("Google no longer accepts this Analytics connection. Reconnect it.");
  if (response.status === 403) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: unknown; details?: { reason?: unknown }[] } } | null;
    const disabled = body?.error?.details?.some((detail) => detail?.reason === "SERVICE_DISABLED");
    if (disabled) throw new SeoAccessError(`The ${api} is not enabled in the Google Cloud project. Enable it there, then try again.`);
    throw new SeoAccessError("This Google account cannot read that Analytics property. Give it at least Viewer access, or connect with an account that has it.");
  }
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after"));
    throw new SeoRateLimitError(Number.isFinite(retry) && retry > 0 ? retry : 60);
  }
  if (!response.ok) throw new SeoProviderError(`Google Analytics answered ${response.status}. The next sync will try again.`);
  try {
    return await response.json();
  } catch {
    throw new SeoProviderError("Google Analytics sent an answer that could not be read.");
  }
}

const str = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

export class GoogleAnalytics implements AnalyticsProvider {
  constructor(
    private readonly token: () => Promise<string>,
    private readonly fetcher: Fetch = fetch,
    private readonly dataApi: string = GA4_DATA_API,
    private readonly adminApi: string = GA4_ADMIN_API,
  ) {}

  async listProperties(): Promise<Ga4PropertySummary[]> {
    const out: Ga4PropertySummary[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < ADMIN_PAGES; page++) {
      const url = new URL(`${this.adminApi}/accountSummaries`);
      url.searchParams.set("pageSize", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const body = (await call(this.fetcher, await this.token(), ADMIN, url.toString())) as {
        accountSummaries?: { account?: unknown; displayName?: unknown; propertySummaries?: { property?: unknown; displayName?: unknown }[] }[];
        nextPageToken?: unknown;
      };
      for (const account of Array.isArray(body?.accountSummaries) ? body.accountSummaries : []) {
        for (const property of Array.isArray(account?.propertySummaries) ? account.propertySummaries : []) {
          const id = str(property?.property);
          if (!id || !PROPERTY_ID.test(id)) continue;
          out.push({ property: id, displayName: str(property.displayName) ?? id, account: str(account.account) ?? "", accountName: str(account.displayName) ?? "" });
        }
      }
      pageToken = str(body?.nextPageToken);
      if (!pageToken) break;
    }
    return out;
  }

  async getProperty(property: string): Promise<Ga4PropertyDetail> {
    if (!PROPERTY_ID.test(property)) throw new SeoProviderError("That is not a GA4 property.");
    const body = (await call(this.fetcher, await this.token(), ADMIN, `${this.adminApi}/${property}`)) as { displayName?: unknown; currencyCode?: unknown; timeZone?: unknown };
    return { property, displayName: str(body?.displayName) ?? property, currencyCode: str(body?.currencyCode), timeZone: str(body?.timeZone) };
  }

  async listWebStreams(property: string): Promise<Ga4WebStream[]> {
    if (!PROPERTY_ID.test(property)) throw new SeoProviderError("That is not a GA4 property.");
    const out: Ga4WebStream[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < ADMIN_PAGES; page++) {
      const url = new URL(`${this.adminApi}/${property}/dataStreams`);
      url.searchParams.set("pageSize", "200");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const body = (await call(this.fetcher, await this.token(), ADMIN, url.toString())) as {
        dataStreams?: { type?: unknown; webStreamData?: { defaultUri?: unknown } }[];
        nextPageToken?: unknown;
      };
      for (const stream of Array.isArray(body?.dataStreams) ? body.dataStreams : []) {
        const uri = str(stream?.webStreamData?.defaultUri);
        if (stream?.type === "WEB_DATA_STREAM" && uri) out.push({ defaultUri: uri });
      }
      pageToken = str(body?.nextPageToken);
      if (!pageToken) break;
    }
    return out;
  }

  async runReport(input: Ga4ReportInput): Promise<Ga4RawReport> {
    if (!PROPERTY_ID.test(input.property)) throw new SeoProviderError("That is not a GA4 property.");
    const body = {
      dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
      dimensions: input.dimensions.map((name) => ({ name })),
      metrics: input.metrics.map((name) => ({ name })),
      ...(input.filter ? { dimensionFilter: { filter: { fieldName: input.filter.field, stringFilter: { matchType: "EXACT", value: input.filter.value } } } } : {}),
      ...(input.orderBySessions ? { orderBys: [{ metric: { metricName: "sessions" }, desc: true }] } : {}),
      limit: String(Math.min(Math.max(1, input.limit), GA4_MAX_ROWS)),
      offset: String(input.offset ?? 0),
    };
    return (await call(this.fetcher, await this.token(), DATA, `${this.dataApi}/${input.property}:runReport`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })) as Ga4RawReport;
  }
}

/** Every row of a report, page by page, up to `cap`. */
export async function reportAll(provider: AnalyticsProvider, input: Omit<Ga4ReportInput, "limit" | "offset">, cap: number): Promise<{ report: Ga4RawReport; truncated: boolean }> {
  const rows: NonNullable<Ga4RawReport["rows"]> = [];
  let first: Ga4RawReport | null = null;
  while (rows.length < cap) {
    const limit = Math.min(GA4_MAX_ROWS, cap - rows.length);
    const page = await provider.runReport({ ...input, limit, offset: rows.length });
    first ??= page;
    const batch = Array.isArray(page.rows) ? page.rows : [];
    rows.push(...batch);
    const total = Number(page.rowCount);
    if (batch.length < limit || (Number.isFinite(total) && rows.length >= total)) return { report: { ...first, rows }, truncated: false };
  }
  return { report: { ...(first ?? {}), rows }, truncated: true };
}
