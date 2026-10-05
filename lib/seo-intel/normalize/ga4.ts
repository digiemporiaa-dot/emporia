import { Decimal } from "decimal.js";
import type { Ga4RawReport } from "@/lib/seo-intel/providers/ga4";

/**
 * GA4 report rows → Emporia's own shape. Pure.
 *
 * Columns are found by their header names, never by position. Anything
 * malformed is dropped and counted: a row GA4 did not clearly send is not
 * data. Revenue is parsed as a decimal string straight from GA4's text, so it
 * never passes through a JS number (CLAUDE.md 2 rule 1).
 */

export type Ga4Dimension = "date" | "landingPage" | "sessionDefaultChannelGroup" | "countryId" | "deviceCategory";
export const GA4_METRICS = ["sessions", "engagedSessions", "keyEvents", "totalRevenue"] as const;

export type Ga4Row = {
  date?: string;
  landingPage?: string;
  channel?: string;
  country?: string;
  device?: string;
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  /** Two decimal places, as a string. */
  revenue: string;
};

export const ORGANIC_CHANNEL = "Organic Search";
/** GA4's placeholder for a value it does not know. */
export const NOT_SET = "(not set)";
/** Country code stored for "(not set)", so it never collides with "" (all countries). */
export const UNKNOWN_COUNTRY = "ZZ";

function day(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function count(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function float(value: string): number | null {
  if (!/^\d+(\.\d+)?(e[+-]?\d+)?$/i.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function revenue(value: string): string | null {
  // Refunds can make a day negative; that is GA4's figure, kept as it is.
  if (!/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(value)) return null;
  try {
    const d = new Decimal(value);
    return d.isFinite() ? d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2) : null;
  } catch {
    return null;
  }
}

/** A landing path as GA4 reports it: leading slash, no query, capped; "(not set)" kept. */
export function landingPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === NOT_SET) return NOT_SET;
  const path = (trimmed.split(/[?#]/)[0] ?? trimmed) || "/";
  return (path.startsWith("/") ? path : `/${path}`).slice(0, 1_000);
}

export function normalizeGa4Report(report: Ga4RawReport, dimensions: readonly Ga4Dimension[]): { rows: Ga4Row[]; dropped: number } {
  const dimIndex = new Map((report.dimensionHeaders ?? []).map((header, i) => [header?.name, i]));
  const metIndex = new Map((report.metricHeaders ?? []).map((header, i) => [header?.name, i]));
  const rows: Ga4Row[] = [];
  let dropped = 0;
  if (dimensions.some((d) => !dimIndex.has(d)) || GA4_METRICS.some((m) => !metIndex.has(m))) {
    return { rows, dropped: (report.rows ?? []).length };
  }

  for (const raw of report.rows ?? []) {
    const dim = (name: Ga4Dimension) => {
      const value = raw?.dimensionValues?.[dimIndex.get(name) as number]?.value;
      return typeof value === "string" ? value : null;
    };
    const met = (name: (typeof GA4_METRICS)[number]) => {
      const value = raw?.metricValues?.[metIndex.get(name) as number]?.value;
      return typeof value === "string" ? value : null;
    };
    const values = {
      sessions: count(met("sessions") ?? ""),
      engagedSessions: count(met("engagedSessions") ?? ""),
      keyEvents: float(met("keyEvents") ?? ""),
      revenue: revenue(met("totalRevenue") ?? ""),
    };
    if (values.sessions === null || values.engagedSessions === null || values.keyEvents === null || values.revenue === null) {
      dropped++;
      continue;
    }
    const row: Ga4Row = { sessions: values.sessions, engagedSessions: values.engagedSessions, keyEvents: values.keyEvents, revenue: values.revenue };
    let ok = true;
    for (const name of dimensions) {
      const value = dim(name);
      if (value === null) {
        ok = false;
        break;
      }
      switch (name) {
        case "date": {
          const d = day(value);
          if (!d) ok = false;
          else row.date = d;
          break;
        }
        case "landingPage":
          row.landingPage = landingPath(value);
          break;
        case "sessionDefaultChannelGroup":
          row.channel = (value.trim() || NOT_SET).slice(0, 100);
          break;
        case "countryId":
          row.country = /^[A-Za-z]{2}$/.test(value.trim()) ? value.trim().toUpperCase() : UNKNOWN_COUNTRY;
          break;
        case "deviceCategory":
          row.device = (value.trim().toLowerCase() || NOT_SET).slice(0, 40);
          break;
      }
      if (!ok) break;
    }
    if (!ok) {
      dropped++;
      continue;
    }
    rows.push(row);
  }
  return { rows, dropped };
}
