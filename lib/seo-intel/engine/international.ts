import { isCountryCode } from "@/lib/geo/countries";
import { isLanguageCode } from "@/lib/geo/iso";

/**
 * Language and country versions of a site (Phase 8). Pure.
 *
 * Google reads hreflang as an ISO 639-1 language, optionally a script, and
 * optionally an ISO 3166-1 alpha-2 region — or `x-default`. Anything else is
 * ignored by Google, so it is reported rather than guessed at.
 */

export type HreflangCode =
  | { ok: true; xDefault: true; language: null; region: null }
  | { ok: true; xDefault: false; language: string; region: string | null }
  | { ok: false; reason: string };

const REGION_FIXES: Record<string, string> = { uk: "gb" };

export function checkHreflang(raw: string): HreflangCode {
  const code = raw.trim().toLowerCase();
  if (code === "x-default") return { ok: true, xDefault: true, language: null, region: null };
  if (code.includes("_")) return { ok: false, reason: `Uses an underscore; write it with a hyphen (${code.replace(/_/g, "-")}).` };
  const parts = code.split("-");
  const language = parts[0] ?? "";
  if (!/^[a-z]{2}$/.test(language) || !isLanguageCode(language)) {
    return { ok: false, reason: `"${language}" is not an ISO 639-1 language code.` };
  }
  let index = 1;
  if (parts[index] && /^[a-z]{4}$/.test(parts[index] as string)) index += 1; // script, e.g. zh-hant
  const region = parts[index];
  if (region === undefined) return { ok: true, xDefault: false, language, region: null };
  if (parts.length > index + 1) return { ok: false, reason: "Has more parts than language, script and region." };
  if (REGION_FIXES[region]) return { ok: false, reason: `"${region}" is not a country code; use ${REGION_FIXES[region]}.` };
  if (!/^[a-z]{2}$/.test(region) || !isCountryCode(region.toUpperCase())) {
    return { ok: false, reason: `"${region}" is not an ISO 3166-1 alpha-2 country code.` };
  }
  return { ok: true, xDefault: false, language, region: region.toUpperCase() };
}

/** The primary language of an `<html lang>` value: "en-IN" → "en". */
export function primaryLanguage(lang: string | null): string | null {
  const primary = lang?.trim().toLowerCase().split(/[-_]/)[0];
  return primary ? primary : null;
}

/**
 * A leading locale path segment — `/ae/`, `/en-ae/`, `/en_in/` — and the URL
 * without it. Null segment when the path does not start with one.
 */
export function localeSegment(url: string): { segment: string | null; rest: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { segment: null, rest: url };
  }
  const match = /^\/([a-z]{2})(?:[-_]([a-z]{2}))?(?=\/|$)/i.exec(parsed.pathname);
  const host = parsed.host.replace(/^www\./, "");
  if (match) {
    const first = (match[1] as string).toLowerCase();
    const second = match[2]?.toLowerCase();
    const valid = second
      ? isLanguageCode(first) && isCountryCode(second.toUpperCase())
      : isLanguageCode(first) || isCountryCode(first.toUpperCase());
    if (valid) {
      const rest = parsed.pathname.slice(match[0].length) || "/";
      return { segment: match[0].slice(1).toLowerCase().replace("_", "-"), rest: `${host}${rest}${parsed.search}` };
    }
  }
  return { segment: null, rest: `${host}${parsed.pathname}${parsed.search}` };
}

/** Two URLs that are the same page under different locale segments. */
export function areLocaleVariants(a: string, b: string): boolean {
  const left = localeSegment(a);
  const right = localeSegment(b);
  if (left.segment === right.segment) return false;
  return left.rest === right.rest;
}

/**
 * The countries a site has a version for: hreflang regions, locale segments
 * that are country codes, and the website's default market. A language-only
 * hreflang ("ar") names no country.
 */
export function countriesWithVersion(
  pages: { url: string; hreflang: { lang: string; href: string }[] }[],
  defaultCountry: string | null,
): Set<string> {
  const countries = new Set<string>();
  if (defaultCountry) countries.add(defaultCountry.toUpperCase());
  for (const page of pages) {
    for (const entry of page.hreflang) {
      const code = checkHreflang(entry.lang);
      if (code.ok && !code.xDefault && code.region) countries.add(code.region);
    }
    const { segment } = localeSegment(page.url);
    if (segment) {
      const tail = segment.split("-").pop() as string;
      // "/de/" may mean German or Germany; counting it as a country can only
      // hide an alert, never raise a false one.
      if (isCountryCode(tail.toUpperCase())) countries.add(tail.toUpperCase());
    }
  }
  return countries;
}

/** Distinct versions declared through hreflang (x-default excluded). */
export function declaredVersions(pages: { hreflang: { lang: string }[] }[]): Map<string, number> {
  const versions = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const entry of page.hreflang) {
      const code = checkHreflang(entry.lang);
      if (!code.ok || code.xDefault || seen.has(entry.lang)) continue;
      seen.add(entry.lang);
      versions.set(entry.lang, (versions.get(entry.lang) ?? 0) + 1);
    }
  }
  return versions;
}

export type CountryTraffic = { country: string; clicks: number; impressions: number };

/**
 * Countries sending a real share of clicks to a site that serves several
 * countries but none of these. Single-version sites are left alone: foreign
 * traffic to a site with one market is not a missing version.
 */
export function countriesWithoutVersion(
  traffic: CountryTraffic[],
  versions: Set<string>,
  multiVersion: boolean,
  options: { minShare: number; minClicks: number },
): (CountryTraffic & { share: number })[] {
  if (!multiVersion) return [];
  const total = traffic.reduce((sum, row) => sum + row.clicks, 0);
  if (total === 0) return [];
  return traffic
    .map((row) => ({ ...row, share: row.clicks / total }))
    .filter((row) => !versions.has(row.country) && row.clicks >= options.minClicks && row.share >= options.minShare)
    .sort((a, b) => b.clicks - a.clicks);
}
