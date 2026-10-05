import { SeoAccessError, SeoCredentialsError, SeoProviderError, SeoRateLimitError } from "@/lib/seo-intel/providers/errors";

/**
 * The Chrome UX Report API (Phase 11): Core Web Vitals as real Chrome users
 * experienced them over the last 28 days, at the 75th percentile, for a whole
 * origin or one page. Authenticated by an API key, sent in a header so it
 * never appears in a URL or a log line.
 *
 * Google answers 404 when a page or origin has too little traffic to report;
 * that is "no data", not an error. Its numbers arrive sometimes as numbers and
 * sometimes as strings (CLS always as a string), so every figure is read
 * defensively and anything unreadable is null — never a guessed value.
 */

export const CRUX_API = "https://chromeuxreport.googleapis.com/v1";

export type CruxFormFactor = "PHONE" | "DESKTOP";
export type CruxTarget = { origin: string } | { url: string };

export type CruxRecord = {
  /** The last day of the 28-day collection period, YYYY-MM-DD. */
  periodEnd: string;
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  fcp: number | null;
  ttfb: number | null;
};

export interface CruxProvider {
  /** The latest 28 days, or null when Google has too little data. */
  record(target: CruxTarget, formFactor: CruxFormFactor): Promise<CruxRecord | null>;
  /** Up to 25 weekly 28-day periods, oldest first, or [] when there is too little data. */
  history(target: CruxTarget, formFactor: CruxFormFactor): Promise<CruxRecord[]>;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const METRICS = {
  lcp: "largest_contentful_paint",
  inp: "interaction_to_next_paint",
  cls: "cumulative_layout_shift",
  fcp: "first_contentful_paint",
  ttfb: "experimental_time_to_first_byte",
} as const;
type MetricKey = keyof typeof METRICS;
const MS_METRICS: readonly MetricKey[] = ["lcp", "inp", "fcp", "ttfb"];

/** A p75 value: a non-negative finite number, from a number or a numeric string. Milliseconds are whole. */
export function readP75(value: unknown, key: MetricKey): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return MS_METRICS.includes(key) ? Math.round(n) : Math.round(n * 1000) / 1000;
}

type CruxDate = { year?: unknown; month?: unknown; day?: unknown };

/** Google's {year, month, day} as YYYY-MM-DD, or null if it is not a real date. */
export function readCruxDate(value: CruxDate | undefined | null): string | null {
  const [y, m, d] = [value?.year, value?.month, value?.day].map((part) => (typeof part === "number" && Number.isInteger(part) ? part : NaN)) as [number, number, number];
  if (![y, m, d].every(Number.isFinite)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

type RawMetric = { percentiles?: { p75?: unknown }; percentilesTimeseries?: { p75s?: unknown[] } };
type RawRecord = {
  metrics?: Record<string, RawMetric | undefined>;
  collectionPeriod?: { lastDate?: CruxDate };
  collectionPeriods?: { lastDate?: CruxDate }[];
};

const metricOf = (metrics: RawRecord["metrics"], key: MetricKey): RawMetric | undefined =>
  // Google renamed TTFB out of "experimental"; read either.
  metrics?.[METRICS[key]] ?? (key === "ttfb" ? metrics?.["time_to_first_byte"] : undefined);

export function parseRecord(body: unknown): CruxRecord | null {
  const record = (body as { record?: RawRecord } | null)?.record;
  const periodEnd = readCruxDate(record?.collectionPeriod?.lastDate);
  if (!record || !periodEnd) return null;
  const out = { periodEnd } as CruxRecord;
  for (const key of Object.keys(METRICS) as MetricKey[]) out[key] = readP75(metricOf(record.metrics, key)?.percentiles?.p75, key);
  return out;
}

export function parseHistory(body: unknown): CruxRecord[] {
  const record = (body as { record?: RawRecord } | null)?.record;
  const periods = Array.isArray(record?.collectionPeriods) ? record.collectionPeriods : [];
  const out: CruxRecord[] = [];
  periods.forEach((period, i) => {
    const periodEnd = readCruxDate(period?.lastDate);
    if (!periodEnd) return;
    const row = { periodEnd } as CruxRecord;
    for (const key of Object.keys(METRICS) as MetricKey[]) {
      const series = metricOf(record?.metrics, key)?.percentilesTimeseries?.p75s;
      row[key] = readP75(Array.isArray(series) ? series[i] : undefined, key);
    }
    // A period with no figure at all says nothing.
    if (row.lcp !== null || row.inp !== null || row.cls !== null || row.fcp !== null || row.ttfb !== null) out.push(row);
  });
  return out.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

export class ChromeUxReport implements CruxProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: Fetch = fetch,
    private readonly api: string = CRUX_API,
  ) {}

  private async post(path: string, body: Record<string, unknown>): Promise<unknown | null> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.api}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new SeoProviderError("The Chrome UX Report could not be reached. The next check will try again.");
    }
    if (response.status === 404) return null;
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      const error = ((await response.json().catch(() => null)) as { error?: { status?: unknown; details?: { reason?: unknown }[] } } | null)?.error;
      const reasons = (Array.isArray(error?.details) ? error.details : []).map((detail) => detail?.reason);
      if (reasons.includes("SERVICE_DISABLED")) throw new SeoAccessError("The Chrome UX Report API is not enabled for this key's Google Cloud project. Enable it there, then try again.");
      if (reasons.includes("API_KEY_INVALID") || response.status === 401) throw new SeoCredentialsError("Google does not accept the Chrome UX Report API key. Check it in SEO settings.");
      if (response.status === 403) throw new SeoAccessError("This API key is not allowed to use the Chrome UX Report API. Check its restrictions in Google Cloud.");
      throw new SeoProviderError("Google could not read that page address for the Chrome UX Report.");
    }
    if (response.status === 429) {
      const retry = Number(response.headers.get("retry-after"));
      throw new SeoRateLimitError(Number.isFinite(retry) && retry > 0 ? retry : 60);
    }
    if (!response.ok) throw new SeoProviderError(`The Chrome UX Report answered ${response.status}. The next check will try again.`);
    try {
      return await response.json();
    } catch {
      throw new SeoProviderError("The Chrome UX Report sent an answer that could not be read.");
    }
  }

  // No metric list: Google then returns every metric it has, so a renamed
  // metric can never turn the whole request into a 400.
  private body(target: CruxTarget, formFactor: CruxFormFactor) {
    return { ...target, formFactor };
  }

  async record(target: CruxTarget, formFactor: CruxFormFactor): Promise<CruxRecord | null> {
    const body = await this.post("records:queryRecord", this.body(target, formFactor));
    return body === null ? null : parseRecord(body);
  }

  async history(target: CruxTarget, formFactor: CruxFormFactor): Promise<CruxRecord[]> {
    const body = await this.post("records:queryHistoryRecord", this.body(target, formFactor));
    return body === null ? [] : parseHistory(body);
  }
}
