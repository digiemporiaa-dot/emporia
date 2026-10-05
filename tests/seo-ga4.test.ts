import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GoogleAnalytics, reportAll, type Ga4RawReport } from "@/lib/seo-intel/providers/ga4";
import { landingPath, normalizeGa4Report } from "@/lib/seo-intel/normalize/ga4";
import { SeoAccessError, SeoCredentialsError, SeoProviderError, SeoRateLimitError } from "@/lib/seo-intel/providers/errors";
import { reportOf, startGa4Double, type Ga4Double } from "./support/ga4-double";

describe("normalising GA4 reports", () => {
  it("finds columns by name, converts dates and keeps revenue as a decimal string", () => {
    const raw = reportOf(["sessionDefaultChannelGroup", "date"], [["Organic Search", "20260930", 120, 80, "3.5", "1234.565"], ["Direct", "20260930", 10, 2, "0", "-50"]]) as Ga4RawReport;
    expect(normalizeGa4Report(raw, ["date", "sessionDefaultChannelGroup"])).toEqual({
      rows: [
        { date: "2026-09-30", channel: "Organic Search", sessions: 120, engagedSessions: 80, keyEvents: 3.5, revenue: "1234.57" },
        { date: "2026-09-30", channel: "Direct", sessions: 10, engagedSessions: 2, keyEvents: 0, revenue: "-50.00" },
      ],
      dropped: 0,
    });
  });

  it("drops malformed rows and counts them", () => {
    const raw = reportOf(["date"], [["20260931", 1, 1, "0", "0"], ["20260930", "1.5", 1, "0", "0"], ["20260930", "-3", 1, "0", "0"], ["20260930", "1e3", 1, "0", "0"], ["20260930", 1, 1, "-1", "0"], ["20260930", 1, 1, "0", "abc"], ["20260930", 1, 1, "1e2", "1e2"]]) as Ga4RawReport;
    expect(normalizeGa4Report(raw, ["date"])).toEqual({ rows: [{ date: "2026-09-30", sessions: 1, engagedSessions: 1, keyEvents: 100, revenue: "100.00" }], dropped: 6 });
  });

  it("a report missing a requested column is not data", () => {
    const raw = reportOf(["date"], [["20260930", 1, 1, "0", "0"]]) as Ga4RawReport;
    expect(normalizeGa4Report(raw, ["date", "countryId"])).toEqual({ rows: [], dropped: 1 });
    expect(normalizeGa4Report({ ...raw, metricHeaders: [] }, ["date"]).rows).toEqual([]);
  });

  it("countries, devices and landing paths", () => {
    const raw = reportOf(["countryId", "deviceCategory", "landingPage"], [["in", "Mobile", "/services/seo?utm=x"], ["(not set)", "", ""]].map((d) => [...d, 1, 1, "0", "0"])) as Ga4RawReport;
    expect(normalizeGa4Report(raw, ["countryId", "deviceCategory", "landingPage"]).rows.map((r) => [r.country, r.device, r.landingPage])).toEqual([
      ["IN", "mobile", "/services/seo"],
      ["ZZ", "(not set)", "(not set)"],
    ]);
    expect([landingPath("blog"), landingPath(" / "), landingPath("?a=1"), landingPath("(not set)")]).toEqual(["/blog", "/", "/", "(not set)"]);
  });
});

describe("GA4 adapter", () => {
  let double: Ga4Double;
  let provider: GoogleAnalytics;

  beforeAll(async () => {
    double = await startGa4Double();
    provider = new GoogleAnalytics(async () => "ga4-token", fetch, `${double.url}/v1beta`, `${double.url}/v1beta`);
    double.setProperties([
      { account: "accounts/1", displayName: "Northwind", properties: [{ property: "properties/101", displayName: "Northwind web", currency: "AED", timeZone: "Asia/Dubai", streams: ["https://www.northwind.example"] }] },
      { account: "accounts/2", displayName: "Other", properties: [{ property: "properties/202", displayName: "Other web" }] },
    ]);
  });
  afterAll(() => double.close());

  it("lists properties across pages, with the bearer token", async () => {
    double.paginate(true);
    expect(await provider.listProperties()).toEqual([
      { property: "properties/101", displayName: "Northwind web", account: "accounts/1", accountName: "Northwind" },
      { property: "properties/202", displayName: "Other web", account: "accounts/2", accountName: "Other" },
    ]);
    double.paginate(false);
    expect(double.requests.at(-1)?.authorization).toBe("Bearer ga4-token");
  });

  it("reads a property's currency, time zone and web streams only", async () => {
    expect(await provider.getProperty("properties/101")).toEqual({ property: "properties/101", displayName: "Northwind web", currencyCode: "AED", timeZone: "Asia/Dubai" });
    expect(await provider.listWebStreams("properties/101")).toEqual([{ defaultUri: "https://www.northwind.example" }]);
    await expect(provider.getProperty("123")).rejects.toThrow(SeoProviderError);
  });

  it("sends the report with the organic filter, order and paging", async () => {
    // rowCount is GA4's total of matching rows, not the page's.
    double.onReport((_p, body) => ({ ...reportOf(["date"], Array.from({ length: Number(body.limit) }, () => ["20260930", 1, 1, "0", "0"])), rowCount: 100 }));
    const { report, truncated } = await reportAll(provider, { property: "properties/101", startDate: "2026-09-01", endDate: "2026-09-30", dimensions: ["date"], metrics: ["sessions"], filter: { field: "sessionDefaultChannelGroup", value: "Organic Search" }, orderBySessions: true }, 5);
    expect(report.rows).toHaveLength(5);
    expect(truncated).toBe(true);
    const body = JSON.parse(double.requests.at(-1)!.body);
    expect(body).toMatchObject({
      dateRanges: [{ startDate: "2026-09-01", endDate: "2026-09-30" }],
      dimensionFilter: { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: "Organic Search" } } },
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: "5",
      offset: "0",
    });
    expect(double.requests.at(-1)?.path).toBe("/v1beta/properties/101:runReport");

    // A short page ends the read; a full one asks for the next offset.
    let calls = 0;
    double.onReport((_p, body) => {
      calls++;
      return { ...reportOf(["date"], Array.from({ length: body.offset === "0" ? 3 : 1 }, () => ["20260930", 1, 1, "0", "0"])), rowCount: 4 };
    });
    const paged = await reportAll(provider, { property: "properties/101", startDate: "a", endDate: "b", dimensions: ["date"], metrics: ["sessions"] }, 10);
    expect([paged.report.rows?.length, paged.truncated, calls]).toEqual([3, false, 1]);

    // Exactly as many rows as the cap, and GA4 says that is all: complete, not truncated.
    double.onReport(() => ({ ...reportOf(["date"], Array.from({ length: 5 }, () => ["20260930", 1, 1, "0", "0"])), rowCount: 5 }));
    const exact = await reportAll(provider, { property: "properties/101", startDate: "a", endDate: "b", dimensions: ["date"], metrics: ["sessions"] }, 5);
    expect([exact.report.rows?.length, exact.truncated]).toEqual([5, false]);
  });

  it("explains each kind of refusal", async () => {
    double.failNext(401);
    await expect(provider.listProperties()).rejects.toThrow(SeoCredentialsError);
    double.failNext(403, { error: { code: 403, status: "PERMISSION_DENIED", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" }] } });
    await expect(provider.listProperties()).rejects.toThrow(/Google Analytics Admin API is not enabled/);
    double.failNext(403, { error: { code: 403, status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } });
    await expect(provider.runReport({ property: "properties/101", startDate: "a", endDate: "b", dimensions: [], metrics: [], limit: 1 })).rejects.toThrow(/Google Analytics Data API is not enabled/);
    double.failNext(403, { error: { code: 403, status: "PERMISSION_DENIED" } });
    await expect(provider.getProperty("properties/101")).rejects.toThrow(/at least Viewer access/);
    double.failNext(403);
    await expect(provider.getProperty("properties/101")).rejects.toThrow(SeoAccessError);
    double.failNext(429);
    await expect(provider.listProperties()).rejects.toThrow(SeoRateLimitError);
    double.failNext(500);
    await expect(provider.listProperties()).rejects.toThrow(/answered 500/);
  });
});
