import { describe, expect, it } from "vitest";
import { daysInMonth, lastMonths, lastWeeks, onMonths, opportunityFlow, weekStart } from "@/lib/seo-intel/engine/history";
import { change, isReportMonth, monthRange, readSeoReportData, reportableMonths, reportMonthLabel, shiftMonth } from "@/lib/seo-intel/report-doc";

/** History shaping and the monthly report's date helpers (Phase 11). Pure. */

const at = (iso: string) => new Date(iso);

describe("weeks and months", () => {
  it("starts weeks on Monday, UTC", () => {
    expect(weekStart(at("2025-03-03T00:00:00Z"))).toBe("2025-03-03"); // a Monday
    expect(weekStart(at("2025-03-09T23:59:59Z"))).toBe("2025-03-03"); // the Sunday after
    expect(weekStart(at("2025-03-10T00:00:00Z"))).toBe("2025-03-10");
    expect(weekStart(at("2025-01-01T12:00:00Z"))).toBe("2024-12-30"); // across a year
  });

  it("lists the last weeks oldest first, ending with this one", () => {
    expect(lastWeeks(3, at("2025-03-12T10:00:00Z"))).toEqual(["2025-02-24", "2025-03-03", "2025-03-10"]);
    expect(lastWeeks(1, at("2025-03-12T10:00:00Z"))).toEqual(["2025-03-10"]);
  });

  it("lists the last months oldest first, across a year", () => {
    expect(lastMonths(4, "2025-02-14")).toEqual(["2024-11", "2024-12", "2025-01", "2025-02"]);
    expect(lastMonths(2, "2025-02")).toEqual(["2025-01", "2025-02"]);
  });

  it("counts days in a month, leap years included", () => {
    expect(daysInMonth("2024-02")).toBe(29);
    expect(daysInMonth("2025-02")).toBe(28);
    expect(daysInMonth("2025-12")).toBe(31);
    expect(daysInMonth("2025-04")).toBe(30);
  });

  it("places rows on the month axis and leaves missing months null, not zero", () => {
    const rows = [{ month: "2025-01", clicks: 5 }, { month: "2024-06", clicks: 9 }];
    expect(onMonths(rows, ["2024-12", "2025-01", "2025-02"])).toEqual([null, { month: "2025-01", clicks: 5 }, null]);
  });
});

describe("opportunity flow", () => {
  const weeks = ["2025-03-03", "2025-03-10"];
  const base = { resolvedAt: null, dismissedAt: null };

  it("counts opened by first sight and closed by what the item is now", () => {
    const flow = opportunityFlow(
      [
        { ...base, firstSeenAt: at("2025-03-04T00:00:00Z"), status: "OPEN" },
        { ...base, firstSeenAt: at("2025-03-04T00:00:00Z"), status: "DONE", resolvedAt: at("2025-03-11T00:00:00Z") },
        { ...base, firstSeenAt: at("2025-03-05T00:00:00Z"), status: "RESOLVED", resolvedAt: at("2025-03-06T00:00:00Z") },
        { ...base, firstSeenAt: at("2025-03-12T00:00:00Z"), status: "DISMISSED", dismissedAt: at("2025-03-13T00:00:00Z") },
        // Reopened: it was resolved once, but it is open now, so it closes nothing.
        { ...base, firstSeenAt: at("2025-03-12T00:00:00Z"), status: "OPEN", resolvedAt: at("2025-03-13T00:00:00Z") },
        // Outside the window entirely.
        { ...base, firstSeenAt: at("2025-01-01T00:00:00Z"), status: "DONE", resolvedAt: at("2025-01-02T00:00:00Z") },
      ],
      weeks,
    );
    expect(flow).toEqual([
      { week: "2025-03-03", opened: 3, done: 0, resolved: 1, dismissed: 0 },
      { week: "2025-03-10", opened: 2, done: 1, resolved: 0, dismissed: 1 },
    ]);
  });

  it("counts an item opened before the window but closed inside it", () => {
    const flow = opportunityFlow([{ ...base, firstSeenAt: at("2025-02-01T00:00:00Z"), status: "DONE", resolvedAt: at("2025-03-10T08:00:00Z") }], weeks);
    expect(flow[1]).toEqual({ week: "2025-03-10", opened: 0, done: 1, resolved: 0, dismissed: 0 });
    expect(flow[0]?.opened).toBe(0);
  });

  it("does not count a reopened item as dismissed because it once was", () => {
    const flow = opportunityFlow([{ firstSeenAt: at("2025-02-01T00:00:00Z"), status: "OPEN", resolvedAt: null, dismissedAt: at("2025-03-11T00:00:00Z") }], weeks);
    expect(flow[1]).toEqual({ week: "2025-03-10", opened: 0, done: 0, resolved: 0, dismissed: 0 });
  });

  it("ignores a closed status with no closing date", () => {
    const flow = opportunityFlow([{ ...base, firstSeenAt: at("2025-03-04T00:00:00Z"), status: "DISMISSED" }], weeks);
    expect(flow[0]).toEqual({ week: "2025-03-03", opened: 1, done: 0, resolved: 0, dismissed: 0 });
  });
});

describe("report months", () => {
  it("offers only completed months, newest first", () => {
    expect(reportableMonths(at("2025-03-01T00:00:00Z"), 3)).toEqual(["2025-02", "2025-01", "2024-12"]);
    expect(reportableMonths(at("2025-03-31T23:59:59Z"))).toHaveLength(13);
    expect(reportableMonths(at("2025-03-31T23:59:59Z"))).not.toContain("2025-03");
    expect(reportableMonths(at("2025-03-31T23:59:59Z")).at(-1)).toBe("2024-02");
  });

  it("knows a month's first and last day", () => {
    expect(monthRange("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthRange("2025-12")).toEqual({ start: "2025-12-01", end: "2025-12-31" });
  });

  it("shifts months across years", () => {
    expect(shiftMonth("2025-01", -1)).toBe("2024-12");
    expect(shiftMonth("2025-03", -12)).toBe("2024-03");
    expect(shiftMonth("2024-12", 1)).toBe("2025-01");
  });

  it("validates and labels months", () => {
    expect(isReportMonth("2025-02")).toBe(true);
    expect(isReportMonth("2025-13")).toBe(false);
    expect(isReportMonth("2025-2")).toBe(false);
    expect(reportMonthLabel("2025-02")).toBe("February 2025");
  });

  it("compares only where there is a base", () => {
    expect(change(150, 100)).toBeCloseTo(0.5);
    expect(change(50, 100)).toBeCloseTo(-0.5);
    expect(change(5, 0)).toBeNull();
    expect(change(null, 100)).toBeNull();
    expect(change(100, null)).toBeNull();
  });

  it("refuses stored report data that does not match the schema", () => {
    expect(readSeoReportData({ version: 2 })).toBeNull();
    expect(readSeoReportData(null)).toBeNull();
    const minimal = {
      version: 1,
      website: { name: "Site", domain: "example.com", client: "Client" },
      month: "2025-02",
      generatedAt: "2025-03-03T00:00:00.000Z",
      search: null,
      keywords: null,
      organic: null,
      technical: null,
      opportunities: { opened: 0, done: 0, resolved: 0, openNow: 0, top: [] },
      reviews: null,
      cwv: null,
      changes: [],
    };
    expect(readSeoReportData(minimal)).toEqual(minimal);
    expect(readSeoReportData({ ...minimal, month: "2025-13" })).toBeNull();
  });
});
