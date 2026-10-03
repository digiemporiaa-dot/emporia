/**
 * Search Console days.
 *
 * Google reports Search Console data by **Pacific-time** day, so "yesterday"
 * here is yesterday in Los Angeles, not on the server. Days travel as
 * "YYYY-MM-DD" strings and are stored as `@db.Date` (UTC midnight), which
 * avoids every time-zone shift in between. Pure.
 */

export const GSC_TIME_ZONE = "America/Los_Angeles";

/** Today's date in a time zone, as "YYYY-MM-DD". */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Every day from start to end, inclusive, oldest first. */
export function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) out.push(day);
  return out;
}

export const toDbDate = (day: string): Date => new Date(`${day}T00:00:00Z`);
export const fromDbDate = (date: Date): string => date.toISOString().slice(0, 10);

/** The earlier / later of two days. */
export const minDay = (a: string, b: string) => (a < b ? a : b);
export const maxDay = (a: string, b: string) => (a > b ? a : b);
