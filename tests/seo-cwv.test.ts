import { describe, expect, it } from "vitest";
import { ChromeUxReport, parseHistory, parseRecord, readCruxDate, readP75 } from "@/lib/seo-intel/providers/crux";
import { SeoAccessError, SeoCredentialsError, SeoProviderError, SeoRateLimitError } from "@/lib/seo-intel/providers/errors";
import { cruxOrigins, cwvVerdict, rateMetric } from "@/lib/seo-intel/engine/cwv";

/** Core Web Vitals (Phase 11): reading CrUX answers, Google's thresholds and verdicts. Pure. */

const RECORD = {
  record: {
    key: { origin: "https://example.com", formFactor: "PHONE" },
    metrics: {
      largest_contentful_paint: { percentiles: { p75: 2345 } },
      interaction_to_next_paint: { percentiles: { p75: "180" } },
      cumulative_layout_shift: { percentiles: { p75: "0.05" } },
      first_contentful_paint: { percentiles: { p75: 1200.6 } },
      experimental_time_to_first_byte: { percentiles: { p75: 650 } },
    },
    collectionPeriod: { firstDate: { year: 2025, month: 2, day: 1 }, lastDate: { year: 2025, month: 2, day: 28 } },
  },
};

type Seen = { url: string; init: RequestInit | undefined };
function fetcher(status: number, body: unknown, headers: Record<string, string> = {}) {
  const seen: Seen[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    seen.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  };
  return { fn, seen };
}

describe("reading CrUX answers", () => {
  it("reads p75 values from numbers or numeric strings, whole milliseconds and CLS to three places", () => {
    expect(readP75(2345.4, "lcp")).toBe(2345);
    expect(readP75("180", "inp")).toBe(180);
    expect(readP75("0.05", "cls")).toBe(0.05);
    expect(readP75("0.12345", "cls")).toBe(0.123);
    expect(readP75(0, "cls")).toBe(0);
    for (const bad of [undefined, null, "", " ", "abc", -1, Number.NaN, Number.POSITIVE_INFINITY, {}]) expect(readP75(bad, "lcp")).toBeNull();
  });

  it("reads Google's dates and refuses impossible ones", () => {
    expect(readCruxDate({ year: 2025, month: 2, day: 28 })).toBe("2025-02-28");
    expect(readCruxDate({ year: 2025, month: 2, day: 29 })).toBeNull();
    expect(readCruxDate({ year: 2025, month: 13, day: 1 })).toBeNull();
    expect(readCruxDate({ year: "2025", month: 2, day: 1 })).toBeNull();
    expect(readCruxDate({ year: 2025, month: 2.5, day: 1 })).toBeNull();
    expect(readCruxDate(undefined)).toBeNull();
  });

  it("parses a record, with the renamed TTFB metric too", () => {
    expect(parseRecord(RECORD)).toEqual({ periodEnd: "2025-02-28", lcp: 2345, inp: 180, cls: 0.05, fcp: 1201, ttfb: 650 });
    const renamed = structuredClone(RECORD) as { record: { metrics: Record<string, unknown> } };
    delete renamed.record.metrics["experimental_time_to_first_byte"];
    renamed.record.metrics["time_to_first_byte"] = { percentiles: { p75: 700 } };
    expect(parseRecord(renamed)?.ttfb).toBe(700);
  });

  it("leaves a missing metric null and refuses a record without a period", () => {
    const partial = { record: { metrics: { largest_contentful_paint: { percentiles: { p75: 3000 } } }, collectionPeriod: RECORD.record.collectionPeriod } };
    expect(parseRecord(partial)).toEqual({ periodEnd: "2025-02-28", lcp: 3000, inp: null, cls: null, fcp: null, ttfb: null });
    expect(parseRecord({ record: { metrics: RECORD.record.metrics } })).toBeNull();
    expect(parseRecord(null)).toBeNull();
    expect(parseRecord({})).toBeNull();
  });

  it("parses history oldest first, skipping periods with no figures and bad dates", () => {
    const history = {
      record: {
        metrics: {
          largest_contentful_paint: { percentilesTimeseries: { p75s: [3000, null, 2500, 2400] } },
          cumulative_layout_shift: { percentilesTimeseries: { p75s: ["0.20", null, "0.10", "0.09"] } },
        },
        collectionPeriods: [
          { lastDate: { year: 2025, month: 2, day: 14 } },
          { lastDate: { year: 2025, month: 2, day: 21 } },
          { lastDate: { year: 2025, month: 2, day: 31 } },
          { lastDate: { year: 2025, month: 2, day: 7 } },
        ],
      },
    };
    expect(parseHistory(history)).toEqual([
      { periodEnd: "2025-02-07", lcp: 2400, inp: null, cls: 0.09, fcp: null, ttfb: null },
      { periodEnd: "2025-02-14", lcp: 3000, inp: null, cls: 0.2, fcp: null, ttfb: null },
    ]);
    expect(parseHistory({})).toEqual([]);
  });
});

describe("the CrUX client", () => {
  it("posts the target and form factor with the key in a header, never in the URL", async () => {
    const { fn, seen } = fetcher(200, RECORD);
    const client = new ChromeUxReport("secret-key-123", fn, "https://crux.test/v1");
    expect(await client.record({ origin: "https://example.com" }, "PHONE")).toMatchObject({ lcp: 2345 });
    expect(seen[0]?.url).toBe("https://crux.test/v1/records:queryRecord");
    expect(seen[0]?.url).not.toContain("secret");
    expect(seen[0]?.init?.method).toBe("POST");
    expect((seen[0]?.init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key-123");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ origin: "https://example.com", formFactor: "PHONE" });

    const history = fetcher(200, { record: { metrics: {}, collectionPeriods: [] } });
    await new ChromeUxReport("k", history.fn, "https://crux.test/v1").history({ url: "https://example.com/a" }, "DESKTOP");
    expect(history.seen[0]?.url).toBe("https://crux.test/v1/records:queryHistoryRecord");
    expect(JSON.parse(String(history.seen[0]?.init?.body))).toEqual({ url: "https://example.com/a", formFactor: "DESKTOP" });
  });

  it("treats 404 as too little data", async () => {
    const client = new ChromeUxReport("k", fetcher(404, { error: { status: "NOT_FOUND" } }).fn);
    expect(await client.record({ origin: "https://quiet.example" }, "PHONE")).toBeNull();
    expect(await client.history({ origin: "https://quiet.example" }, "PHONE")).toEqual([]);
  });

  it("says what is wrong with the key or the project", async () => {
    const run = (status: number, body: unknown) => new ChromeUxReport("k", fetcher(status, body).fn).record({ origin: "https://x.example" }, "PHONE");
    await expect(run(400, { error: { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } })).rejects.toBeInstanceOf(SeoCredentialsError);
    await expect(run(403, { error: { details: [{ reason: "SERVICE_DISABLED" }] } })).rejects.toThrow(/not enabled/);
    await expect(run(403, { error: { details: [{ reason: "API_KEY_SERVICE_BLOCKED" }] } })).rejects.toBeInstanceOf(SeoAccessError);
    await expect(run(401, {})).rejects.toBeInstanceOf(SeoCredentialsError);
    await expect(run(400, { error: { status: "INVALID_ARGUMENT" } })).rejects.toBeInstanceOf(SeoProviderError);
    await expect(run(500, {})).rejects.toBeInstanceOf(SeoProviderError);
    await expect(run(200, "not json")).rejects.toBeInstanceOf(SeoProviderError);
  });

  it("passes on Google's retry-after when rate limited", async () => {
    const error = await new ChromeUxReport("k", fetcher(429, {}, { "retry-after": "30" }).fn).record({ origin: "https://x.example" }, "PHONE").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SeoRateLimitError);
    expect((error as SeoRateLimitError).retryAfterSeconds).toBe(30);
    const fallback = await new ChromeUxReport("k", fetcher(429, {}).fn).record({ origin: "https://x.example" }, "PHONE").catch((e: unknown) => e);
    expect((fallback as SeoRateLimitError).retryAfterSeconds).toBe(60);
  });

  it("reports an unreachable API as retryable", async () => {
    const client = new ChromeUxReport("k", async () => {
      throw new TypeError("network down");
    });
    await expect(client.record({ origin: "https://x.example" }, "PHONE")).rejects.toBeInstanceOf(SeoProviderError);
  });
});

describe("thresholds and verdicts", () => {
  it("rates at Google's boundaries: good at or under, poor only over", () => {
    expect(rateMetric("lcp", 2500)).toBe("good");
    expect(rateMetric("lcp", 2501)).toBe("needs-improvement");
    expect(rateMetric("lcp", 4000)).toBe("needs-improvement");
    expect(rateMetric("lcp", 4001)).toBe("poor");
    expect(rateMetric("inp", 200)).toBe("good");
    expect(rateMetric("inp", 501)).toBe("poor");
    expect(rateMetric("cls", 0.1)).toBe("good");
    expect(rateMetric("cls", 0.25)).toBe("needs-improvement");
    expect(rateMetric("cls", 0.26)).toBe("poor");
    expect(rateMetric("fcp", 1800)).toBe("good");
    expect(rateMetric("ttfb", 1801)).toBe("poor");
    expect(rateMetric("lcp", null)).toBeNull();
  });

  it("passes a page only when all three core metrics are good", () => {
    expect(cwvVerdict({ lcp: 2000, inp: 150, cls: 0.05 })).toBe("good");
    expect(cwvVerdict({ lcp: 2000, inp: 150, cls: null })).toBe("needs-improvement");
    expect(cwvVerdict({ lcp: 3000, inp: 150, cls: 0.05 })).toBe("needs-improvement");
    expect(cwvVerdict({ lcp: 2000, inp: 600, cls: 0.05 })).toBe("poor");
    expect(cwvVerdict({ lcp: null, inp: null, cls: 0.3 })).toBe("poor");
    expect(cwvVerdict({ lcp: null, inp: null, cls: null })).toBeNull();
  });

  it("asks about the site's own origin first, then the other www variant", () => {
    expect(cruxOrigins("example.com", "HTTPS")).toEqual(["https://example.com", "https://www.example.com"]);
    expect(cruxOrigins("WWW.Example.com", "HTTP")).toEqual(["http://www.example.com", "http://example.com"]);
  });
});
