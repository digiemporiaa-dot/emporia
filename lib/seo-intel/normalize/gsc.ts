import type { GscDimension, GscRawRow } from "@/lib/seo-intel/providers/types";

/**
 * Search Console rows → Emporia's own shape.
 *
 * Pure. Anything malformed is dropped and counted, never coerced into a
 * plausible number: a row Google did not clearly send is not data.
 */

export type GscMetrics = { clicks: number; impressions: number; position: number };

export type NormalizedRow = GscMetrics & {
  date?: string;
  query?: string;
  page?: string;
  country?: string;
  device?: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEVICES = new Set(["DESKTOP", "MOBILE", "TABLET"]);

function validDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function count(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  // Google sends integers; a fraction would be a bug upstream, not a half-click.
  return Number.isInteger(value) ? value : null;
}

export function normalizeGscRows(
  rows: readonly GscRawRow[],
  dimensions: readonly GscDimension[],
): { rows: NormalizedRow[]; dropped: number } {
  const out: NormalizedRow[] = [];
  let dropped = 0;

  for (const raw of rows) {
    const keys = Array.isArray(raw.keys) ? raw.keys : null;
    const clicks = count(raw.clicks);
    const impressions = count(raw.impressions);
    const position = typeof raw.position === "number" && Number.isFinite(raw.position) && raw.position >= 1 ? raw.position : null;

    if (
      !keys ||
      keys.length !== dimensions.length ||
      !keys.every((key) => typeof key === "string") ||
      clicks === null ||
      impressions === null ||
      position === null ||
      clicks > impressions
    ) {
      dropped++;
      continue;
    }

    const row: NormalizedRow = { clicks, impressions, position };
    let ok = true;
    dimensions.forEach((dimension, index) => {
      const key = (keys[index] as string).trim();
      switch (dimension) {
        case "date":
          if (validDate(key)) row.date = key;
          else ok = false;
          break;
        case "query":
          if (key) row.query = key.slice(0, 500);
          else ok = false;
          break;
        case "page":
          if (/^https?:\/\//i.test(key)) row.page = key.slice(0, 2000);
          else ok = false;
          break;
        case "country":
          if (/^[a-z]{3}$/i.test(key)) row.country = key.toLowerCase();
          else ok = false;
          break;
        case "device":
          if (DEVICES.has(key.toUpperCase())) row.device = key.toUpperCase();
          else ok = false;
          break;
        default:
          ok = false;
      }
    });

    if (ok) out.push(row);
    else dropped++;
  }

  return { rows: out, dropped };
}

/** Click-through rate as a fraction, or null when there were no impressions. */
export function ctr(metrics: { clicks: number; impressions: number }): number | null {
  return metrics.impressions > 0 ? metrics.clicks / metrics.impressions : null;
}

/**
 * Combine rows into one: clicks and impressions add; position is re-weighted
 * by impressions, because an average of averages is wrong whenever the rows
 * had different volumes.
 */
export function combine(rows: readonly GscMetrics[]): GscMetrics & { ctr: number | null } {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const row of rows) {
    clicks += row.clicks;
    impressions += row.impressions;
    weighted += row.position * row.impressions;
  }
  return { clicks, impressions, position: impressions > 0 ? weighted / impressions : 0, ctr: ctr({ clicks, impressions }) };
}
