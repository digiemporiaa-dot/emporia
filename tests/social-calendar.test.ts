import { describe, expect, it } from "vitest";
import {
  addDays,
  buildGrid,
  bucketByDay,
  CALENDAR_TIME_ZONE,
  parseAnchor,
  startOfWeek,
  startOfZonedDay,
  weekdayIndex,
  ymdKey,
  zonedDayKey,
  zoneLabel,
} from "@/lib/social/calendar";

const IST = CALENDAR_TIME_ZONE;

describe("zoned days", () => {
  it("files a late-evening IST post under the day its author meant", () => {
    // 6 Oct 2026, 01:00 IST is 5 Oct 19:30 UTC. A UTC grid shows it on the 5th.
    const instant = new Date("2026-10-05T19:30:00Z");
    expect(zonedDayKey(instant, IST)).toBe("2026-10-06");
    expect(zonedDayKey(instant, "UTC")).toBe("2026-10-05");
  });

  it("files the brief's 7:30pm example on the day it reads", () => {
    expect(zonedDayKey(new Date("2026-10-05T14:00:00Z"), IST)).toBe("2026-10-05");
  });

  it("finds the instant a day starts in a zone", () => {
    const start = startOfZonedDay({ year: 2026, month: 10, day: 6 }, IST);
    expect(start.toISOString()).toBe("2026-10-05T18:30:00.000Z");
  });

  it("handles a zone that observes daylight saving, on both sides of the switch", () => {
    // New York moves to EST on 1 Nov 2026.
    const before = startOfZonedDay({ year: 2026, month: 10, day: 30 }, "America/New_York");
    const after = startOfZonedDay({ year: 2026, month: 11, day: 2 }, "America/New_York");
    expect(before.toISOString()).toBe("2026-10-30T04:00:00.000Z");
    expect(after.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  it("round-trips every day of a month through start-of-day and back", () => {
    for (let day = 1; day <= 31; day++) {
      const ymd = { year: 2026, month: 10, day };
      expect(zonedDayKey(startOfZonedDay(ymd, IST), IST)).toBe(ymdKey(ymd));
    }
  });
});

describe("grid arithmetic", () => {
  it("rolls over month and year ends", () => {
    expect(addDays({ year: 2026, month: 10, day: 31 }, 1)).toEqual({ year: 2026, month: 11, day: 1 });
    expect(addDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
    expect(addDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it("starts the week on Monday", () => {
    // 8 Oct 2026 is a Thursday.
    expect(weekdayIndex({ year: 2026, month: 10, day: 8 })).toBe(3);
    expect(startOfWeek({ year: 2026, month: 10, day: 8 })).toEqual({
      year: 2026,
      month: 10,
      day: 5,
    });
  });
});

describe("buildGrid", () => {
  const now = new Date("2026-10-08T06:00:00Z");

  it("draws six rows whatever the month, so the page below never jumps", () => {
    for (let month = 1; month <= 12; month++) {
      const grid = buildGrid("month", { year: 2026, month, day: 1 }, IST, now);
      expect(grid.days).toHaveLength(42);
      expect(grid.days[0]!.weekday).toBe(0);
    }
  });

  it("marks only the anchor month as in-period", () => {
    const grid = buildGrid("month", { year: 2026, month: 10, day: 1 }, IST, now);
    const inPeriod = grid.days.filter((day) => day.inPeriod);
    expect(inPeriod).toHaveLength(31);
    expect(inPeriod[0]!.key).toBe("2026-10-01");
    expect(inPeriod.at(-1)!.key).toBe("2026-10-31");
  });

  it("covers the whole drawn grid in its query range, borrowed days included", () => {
    const grid = buildGrid("month", { year: 2026, month: 10, day: 1 }, IST, now);
    // The range must start no later than the first cell and end after the last.
    expect(grid.range.from.getTime()).toBeLessThanOrEqual(
      startOfZonedDay(grid.days[0]!, IST).getTime(),
    );
    expect(grid.range.to.getTime()).toBeGreaterThan(
      startOfZonedDay(grid.days.at(-1)!, IST).getTime(),
    );
  });

  it("leaves no gap between one month's range and the next", () => {
    const october = buildGrid("list", { year: 2026, month: 10, day: 1 }, IST, now);
    const november = buildGrid("list", { year: 2026, month: 11, day: 1 }, IST, now);
    expect(october.range.to.toISOString()).toBe(november.range.from.toISOString());
  });

  it("pages month to month, including across a year boundary", () => {
    const december = buildGrid("month", { year: 2026, month: 12, day: 1 }, IST, now);
    expect(december.next).toBe("2027-01");
    expect(december.previous).toBe("2026-11");
    const january = buildGrid("month", { year: 2027, month: 1, day: 1 }, IST, now);
    expect(january.previous).toBe("2026-12");
  });

  it("gives the week view seven days and a seven-day range", () => {
    const grid = buildGrid("week", { year: 2026, month: 10, day: 8 }, IST, now);
    expect(grid.days.map((day) => day.key)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ]);
    expect(grid.range.to.getTime() - grid.range.from.getTime()).toBe(7 * 24 * 3600 * 1000);
    expect(grid.next).toBe("2026-10-12");
    expect(grid.previous).toBe("2026-09-28");
  });

  it("gives the day view exactly one day", () => {
    const grid = buildGrid("day", { year: 2026, month: 10, day: 8 }, IST, now);
    expect(grid.days).toHaveLength(1);
    expect(grid.range.from.toISOString()).toBe("2026-10-07T18:30:00.000Z");
    expect(grid.range.to.toISOString()).toBe("2026-10-08T18:30:00.000Z");
  });

  it("marks today in the zone, not in UTC", () => {
    // 00:30 IST on the 9th is still the 8th in UTC.
    const lateNight = new Date("2026-10-08T19:00:00Z");
    const grid = buildGrid("month", { year: 2026, month: 10, day: 1 }, IST, lateNight);
    expect(grid.days.filter((day) => day.isToday).map((day) => day.key)).toEqual(["2026-10-09"]);
  });

  it("titles each view for what it shows", () => {
    expect(buildGrid("month", { year: 2026, month: 10, day: 1 }, IST, now).title).toBe("October 2026");
    expect(buildGrid("week", { year: 2026, month: 10, day: 8 }, IST, now).title).toBe("5–11 Oct 2026");
  });
});

describe("parseAnchor", () => {
  const now = new Date("2026-10-08T19:00:00Z");

  it("reads a month and a day anchor", () => {
    expect(parseAnchor("2026-10", IST, now)).toEqual({ year: 2026, month: 10, day: 1 });
    expect(parseAnchor("2026-10-05", IST, now)).toEqual({ year: 2026, month: 10, day: 5 });
  });

  it("falls back to today in the calendar's zone rather than throwing", () => {
    for (const bad of [null, "", "nonsense", "2026-13", "2026-10-99", "10-2026"]) {
      expect(parseAnchor(bad, IST, now)).toEqual({ year: 2026, month: 10, day: 9 });
    }
  });
});

describe("bucketByDay", () => {
  it("groups by the zone's day and drops undated items", () => {
    const items = [
      { id: "a", at: new Date("2026-10-05T19:30:00Z") },
      { id: "b", at: new Date("2026-10-06T04:00:00Z") },
      { id: "c", at: null },
    ];
    const buckets = bucketByDay(items, (item) => item.at, IST);
    expect([...buckets.keys()]).toEqual(["2026-10-06"]);
    expect(buckets.get("2026-10-06")!.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("zoneLabel", () => {
  it("names the offset the grid is drawn in", () => {
    expect(zoneLabel(IST, new Date("2026-10-08T06:00:00Z"))).toBe("GMT+5:30");
  });
});
