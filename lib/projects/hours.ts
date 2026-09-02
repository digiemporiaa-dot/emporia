import { Decimal } from "@/lib/money";

/**
 * Time is entered in hours and stored in whole minutes.
 *
 * An integer minute count has no rounding error to accumulate over a month of
 * entries, and it is what every later total (utilisation, billable time, an
 * eventual invoice line) is derived from. The conversion goes through Decimal
 * rather than JS floats: 7.1 * 60 is 425.99999999999994 in binary floating
 * point, which would silently lose a minute.
 */
export function hoursToMinutes(hours: string): number {
  const minutes = new Decimal(hours).times(60);
  if (!minutes.isInteger()) {
    // 7.5h is 450 minutes; 7.51h is not a whole minute, so round to the nearest
    // one rather than storing a fraction the schema cannot hold.
    return minutes.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  }
  return minutes.toNumber();
}

/** Whole minutes back to a display string of hours, to two decimals. */
export function minutesToHours(minutes: number): string {
  return new Decimal(minutes).dividedBy(60).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** "7h 30m" for a UI that should not make people read decimals of an hour. */
export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const total = Math.abs(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${sign}${rest}m`;
  if (rest === 0) return `${sign}${hours}h`;
  return `${sign}${hours}h ${rest}m`;
}
