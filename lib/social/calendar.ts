/**
 * The calendar's grid, and the range to fetch for it.
 *
 * Pure — no database, no React — so the awkward part can be tested directly.
 * The awkward part is timezones.
 *
 * ## Why this is not simply "local time"
 *
 * A post is stored as an instant (UTC). A calendar cell is a *day*, and which
 * day an instant falls on depends entirely on the zone you ask in: 7:30pm on
 * the 5th in Delhi is 2:00pm on the 5th in UTC and 9:00am on the 5th in New
 * York — but 1:00am on the 6th in Delhi is still the 5th in UTC, and a grid
 * built in UTC files that post under the wrong day, every time, for everyone.
 *
 * Two ways out. Render in the *reader's* zone, which means rendering on the
 * client and accepting that the server and the browser disagree during
 * hydration; or pick one zone, render on the server, and say on screen which
 * zone it is. This takes the second: the grid is deterministic, two people
 * opening the same link see the same thing, the page stays a Server Component,
 * and the zone is printed above the grid so nobody has to guess.
 *
 * Everything here is therefore parameterised by an IANA zone rather than
 * quietly using the runtime's.
 */

/**
 * The zone the calendar is drawn in.
 *
 * One agency, one operating timezone. When clients in other markets need their
 * own, this becomes a column on `Client` and a parameter threaded through
 * `buildGrid` — which is why every function below already takes the zone
 * rather than reaching for this constant.
 */
export const CALENDAR_TIME_ZONE = "Asia/Kolkata";

export const CALENDAR_VIEWS = ["month", "week", "day", "list"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export function isCalendarView(value: string): value is CalendarView {
  return (CALENDAR_VIEWS as readonly string[]).includes(value);
}

/** A calendar day, as a person names one: three numbers, no instant. */
export type YMD = { year: number; month: number; day: number };

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD`. The key a card is filed under. */
export function ymdKey({ year, month, day }: YMD): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Grid arithmetic runs on a UTC proxy: midday UTC on the given day.
 *
 * Midday rather than midnight so that adding days can never trip over a DST
 * transition, and UTC rather than local so `getUTCDay` and `setUTCDate` are
 * exact. The proxy is never shown and never queried — it is turned back into
 * a real instant by `startOfZonedDay` at the edges.
 */
function proxy({ year, month, day }: YMD): Date {
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function fromProxy(date: Date): YMD {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function addDays(ymd: YMD, days: number): YMD {
  const next = proxy(ymd);
  next.setUTCDate(next.getUTCDate() + days);
  return fromProxy(next);
}

/** 0 = Monday. A work calendar starts its week on Monday. */
export function weekdayIndex(ymd: YMD): number {
  return (proxy(ymd).getUTCDay() + 6) % 7;
}

export function startOfWeek(ymd: YMD): YMD {
  return addDays(ymd, -weekdayIndex(ymd));
}

const PARTS_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = PARTS_CACHE.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    PARTS_CACHE.set(timeZone, formatter);
  }
  return formatter;
}

function zonedFields(instant: Date, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    // Midnight comes back as hour 24 from some ICU builds.
    hour: read("hour") % 24,
    minute: read("minute"),
  };
}

/** The hour of the day (0–23) an instant falls in, in a given zone. */
export function zonedHour(instant: Date, timeZone: string): number {
  return zonedFields(instant, timeZone).hour;
}

/** Which calendar day an instant falls on, in a given zone. */
export function zonedDay(instant: Date, timeZone: string): YMD {
  const { year, month, day } = zonedFields(instant, timeZone);
  return { year, month, day };
}

/** `YYYY-MM-DD` for an instant, in a given zone. The bucketing key. */
export function zonedDayKey(instant: Date, timeZone: string): string {
  return ymdKey(zonedDay(instant, timeZone));
}

/**
 * The instant at which a calendar day begins in a zone.
 *
 * Found by guessing UTC midnight, measuring how far the guess lands from the
 * wall clock we wanted, and correcting. Twice, because the correction can
 * itself cross a DST boundary — after two passes the answer is stable for
 * every real zone. Kolkata never shifts, but this runs for whatever zone it is
 * handed, so it does the honest thing rather than the convenient one.
 */
export function startOfZonedDay(ymd: YMD, timeZone: string): Date {
  const target = Date.UTC(ymd.year, ymd.month - 1, ymd.day);
  let instant = new Date(target);
  for (let pass = 0; pass < 2; pass++) {
    const at = zonedFields(instant, timeZone);
    const seen = Date.UTC(at.year, at.month - 1, at.day, at.hour, at.minute);
    const drift = seen - target;
    if (drift === 0) break;
    instant = new Date(instant.getTime() - drift);
  }
  return instant;
}

/** Read the anchor out of a URL. `YYYY-MM` or `YYYY-MM-DD`; today if absent. */
export function parseAnchor(value: string | null, timeZone: string, now = new Date()): YMD {
  const match = value ? /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value.trim()) : null;
  if (!match) return zonedDay(now, timeZone);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) return zonedDay(now, timeZone);
  return { year, month, day };
}

export type CalendarDay = YMD & {
  key: string;
  /** False for the leading and trailing days a month grid borrows. */
  inPeriod: boolean;
  isToday: boolean;
  weekday: number;
};

export type CalendarGrid = {
  view: CalendarView;
  /** What sits above the grid: "October 2026", "5–11 Oct 2026". */
  title: string;
  days: CalendarDay[];
  /** Anchors for the previous and next buttons. */
  previous: string;
  next: string;
  /** Anchor for "today". */
  today: string;
  /** Half-open instant range to query: `from <= scheduledFor < to`. */
  range: { from: Date; to: Date };
};

const MONTH_TITLE = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const DAY_TITLE = new Intl.DateTimeFormat("en-IN", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const SPAN_START = new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: "UTC" });
const SPAN_END = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const monthAnchor = (ymd: YMD) => `${ymd.year}-${pad(ymd.month)}`;

export function buildGrid(
  view: CalendarView,
  anchor: YMD,
  timeZone: string,
  now = new Date(),
): CalendarGrid {
  const todayYmd = zonedDay(now, timeZone);
  const todayKey = ymdKey(todayYmd);

  const cell = (ymd: YMD, inPeriod: boolean): CalendarDay => ({
    ...ymd,
    key: ymdKey(ymd),
    inPeriod,
    isToday: ymdKey(ymd) === todayKey,
    weekday: weekdayIndex(ymd),
  });

  const range = (first: YMD, lastExclusive: YMD) => ({
    from: startOfZonedDay(first, timeZone),
    to: startOfZonedDay(lastExclusive, timeZone),
  });

  if (view === "day") {
    return {
      view,
      title: DAY_TITLE.format(proxy(anchor)),
      days: [cell(anchor, true)],
      previous: ymdKey(addDays(anchor, -1)),
      next: ymdKey(addDays(anchor, 1)),
      today: ymdKey(todayYmd),
      range: range(anchor, addDays(anchor, 1)),
    };
  }

  if (view === "week") {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    return {
      view,
      title: `${SPAN_START.format(proxy(start))}–${SPAN_END.format(proxy(end))}`,
      days: Array.from({ length: 7 }, (_, i) => cell(addDays(start, i), true)),
      previous: ymdKey(addDays(start, -7)),
      next: ymdKey(addDays(start, 7)),
      today: ymdKey(todayYmd),
      range: range(start, addDays(start, 7)),
    };
  }

  // Month and list both span one calendar month and page by month; they differ
  // only in how the days are drawn, so the navigation is shared.
  const first: YMD = { year: anchor.year, month: anchor.month, day: 1 };
  const firstOfNext = nextMonthStart(first);
  const firstOfPrevious = previousMonthStart(first);

  if (view === "list") {
    const days: CalendarDay[] = [];
    for (let d = first; d.month === first.month; d = addDays(d, 1)) days.push(cell(d, true));
    return {
      view,
      title: MONTH_TITLE.format(proxy(first)),
      days,
      previous: monthAnchor(firstOfPrevious),
      next: monthAnchor(firstOfNext),
      today: ymdKey(todayYmd),
      range: range(first, firstOfNext),
    };
  }

  // Six rows, always. A grid that changes height as you page through the year
  // makes everything below it jump.
  const gridStart = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => {
    const day = addDays(gridStart, i);
    return cell(day, day.month === first.month && day.year === first.year);
  });

  return {
    view,
    title: MONTH_TITLE.format(proxy(first)),
    days,
    previous: monthAnchor(firstOfPrevious),
    next: monthAnchor(firstOfNext),
    today: ymdKey(todayYmd),
    range: range(gridStart, addDays(gridStart, 42)),
  };
}

function nextMonthStart({ year, month }: YMD): YMD {
  return month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 };
}

function previousMonthStart({ year, month }: YMD): YMD {
  return month === 1 ? { year: year - 1, month: 12, day: 1 } : { year, month: month - 1, day: 1 };
}

/** File items into day cells by the zone's calendar day. */
export function bucketByDay<T>(
  items: readonly T[],
  when: (item: T) => Date | null,
  timeZone: string,
): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const instant = when(item);
    if (!instant) continue;
    const key = zonedDayKey(instant, timeZone);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }
  return buckets;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The short zone name to print above the grid, e.g. "GMT+5:30". */
export function zoneLabel(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(now)
    .find((part) => part.type === "timeZoneName");
  return parts?.value ?? timeZone;
}
