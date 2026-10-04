import { fold } from "@/lib/seo-intel/engine/local";
import type { BusinessEntity } from "@/lib/seo-intel/crawler/parse";

/**
 * Name, address and phone consistency (Phase 8). Pure.
 *
 * The client's business profile is the truth (decided 2026-10-04); the
 * website's structured data, its phone links and the Google listing are
 * compared with it. Comparisons are forgiving where formats differ and
 * strict where a difference matters: phones by their last ten digits, postal
 * codes exactly, cities and streets after folding and expanding the common
 * abbreviations.
 */

export type NapTruth = {
  names: string[];
  street: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  phone: string | null;
};

export type NapField = "name" | "phone" | "street" | "locality" | "postalCode";

export type NapMismatch = { field: NapField; expected: string; found: string };

const digits = (value: string) => value.replace(/\D/g, "");

/** Same number when the last ten digits agree (country and trunk prefixes vary). */
export function phonesMatch(a: string, b: string): boolean {
  const x = digits(a);
  const y = digits(b);
  if (x.length < 6 || y.length < 6) return false;
  const n = Math.min(10, x.length, y.length);
  return x.slice(-n) === y.slice(-n);
}

/** One name contains the other, as whole words, after folding. */
export function namesMatch(found: string, names: readonly string[]): boolean {
  const f = fold(found);
  if (f === " ") return false;
  return names.some((name) => {
    const n = fold(name);
    return n !== " " && (f.includes(n) || n.includes(f));
  });
}

const ABBREVIATIONS: Record<string, string> = {
  rd: "road", st: "street", ave: "avenue", av: "avenue", blvd: "boulevard", ln: "lane", dr: "drive", hwy: "highway",
  bldg: "building", fl: "floor", flr: "floor", apt: "apartment", nr: "near", opp: "opposite", sec: "sector", ctr: "centre", center: "centre",
};
const NOISE = new Set(["no", "number", "the", "of", "and", "near", "opposite", "floor"]);

function streetTokens(value: string): string[] {
  return fold(value)
    .trim()
    .split(" ")
    .map((token) => ABBREVIATIONS[token] ?? token)
    .filter((token) => token && !NOISE.has(token));
}

/** Most of the shorter street's words appear in the longer one. */
export function streetsMatch(a: string, b: string): boolean {
  const x = streetTokens(a);
  const y = streetTokens(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)];
  return short.filter((token) => long.has(token)).length / short.length >= 0.6;
}

const postal = (value: string) => value.replace(/\s+/g, "").toLowerCase();

/** City names agree, or one contains the other as whole words — so "Mumbai" and "Navi Mumbai" are not told apart. */
export function localitiesMatch(a: string, b: string): boolean {
  const x = fold(a);
  const y = fold(b);
  return x !== " " && y !== " " && (x === y || x.includes(y) || y.includes(x));
}

export type NapSubject = {
  name: string | null;
  phone: string | null;
  street: string | null;
  locality: string | null;
  postalCode: string | null;
};

/** What disagrees with the truth. A field missing on either side is not a mismatch. */
export function compareNap(truth: NapTruth, subject: NapSubject): NapMismatch[] {
  const out: NapMismatch[] = [];
  if (subject.name && truth.names.length && !namesMatch(subject.name, truth.names)) {
    out.push({ field: "name", expected: truth.names[0] as string, found: subject.name });
  }
  if (subject.phone && truth.phone && !phonesMatch(subject.phone, truth.phone)) out.push({ field: "phone", expected: truth.phone, found: subject.phone });
  if (subject.street && truth.street && !streetsMatch(subject.street, truth.street)) out.push({ field: "street", expected: truth.street, found: subject.street });
  if (subject.locality && truth.locality && !localitiesMatch(subject.locality, truth.locality)) {
    out.push({ field: "locality", expected: truth.locality, found: subject.locality });
  }
  if (subject.postalCode && truth.postalCode && postal(subject.postalCode) !== postal(truth.postalCode)) {
    out.push({ field: "postalCode", expected: truth.postalCode, found: subject.postalCode });
  }
  return out;
}

export const REQUIRED_SCHEMA_FIELDS = ["name", "telephone", "streetAddress", "addressLocality", "postalCode", "addressCountry"] as const;
export const RECOMMENDED_SCHEMA_FIELDS = ["geo", "openingHours"] as const;
export type SchemaField = (typeof REQUIRED_SCHEMA_FIELDS)[number] | (typeof RECOMMENDED_SCHEMA_FIELDS)[number];

export function missingSchemaFields(entity: BusinessEntity): { required: SchemaField[]; recommended: SchemaField[] } {
  const has: Record<SchemaField, boolean> = {
    name: !!entity.name,
    telephone: !!entity.telephone,
    streetAddress: !!entity.address?.street,
    addressLocality: !!entity.address?.locality,
    postalCode: !!entity.address?.postalCode,
    addressCountry: !!entity.address?.country,
    geo: entity.hasGeo,
    openingHours: entity.hasHours,
  };
  return {
    required: REQUIRED_SCHEMA_FIELDS.filter((field) => !has[field]),
    recommended: RECOMMENDED_SCHEMA_FIELDS.filter((field) => !has[field]),
  };
}

export type SitePage = { url: string; localBusiness: BusinessEntity[]; phones: string[] };

export type NapReport = {
  /** Pages carrying at least one business entity. */
  schemaPages: number;
  schemaMismatches: { url: string; entity: string | null; mismatches: NapMismatch[] }[];
  incomplete: { url: string; entity: string | null; required: SchemaField[]; recommended: SchemaField[] }[];
  /** Whether the profile's phone appears in any tel: link or schema telephone. */
  phoneOnSite: boolean | null;
  /** tel: numbers on the site that are not the profile's, with how many pages carry each. */
  otherPhones: { phone: string; pages: number }[];
  listing: { name: string; mismatches: NapMismatch[] }[];
};

export function napReport(
  truth: NapTruth,
  pages: readonly SitePage[],
  listings: readonly { name: string; subject: NapSubject }[],
): NapReport {
  const schemaMismatches: NapReport["schemaMismatches"] = [];
  const incomplete: NapReport["incomplete"] = [];
  const other = new Map<string, { phone: string; pages: Set<string> }>();
  let schemaPages = 0;
  let phoneOnSite = false;

  for (const page of pages) {
    if (page.localBusiness.length) schemaPages += 1;
    for (const entity of page.localBusiness) {
      const mismatches = compareNap(truth, {
        name: entity.name,
        phone: entity.telephone,
        street: entity.address?.street ?? null,
        locality: entity.address?.locality ?? null,
        postalCode: entity.address?.postalCode ?? null,
      });
      if (mismatches.length) schemaMismatches.push({ url: page.url, entity: entity.name, mismatches });
      const missing = missingSchemaFields(entity);
      if (missing.required.length || missing.recommended.length) incomplete.push({ url: page.url, entity: entity.name, ...missing });
      if (truth.phone && entity.telephone && phonesMatch(entity.telephone, truth.phone)) phoneOnSite = true;
    }
    for (const phone of page.phones) {
      if (truth.phone && phonesMatch(phone, truth.phone)) {
        phoneOnSite = true;
        continue;
      }
      const key = digits(phone).slice(-10) || phone;
      const entry = other.get(key) ?? { phone, pages: new Set<string>() };
      entry.pages.add(page.url);
      other.set(key, entry);
    }
  }

  return {
    schemaPages,
    schemaMismatches,
    incomplete,
    phoneOnSite: truth.phone ? phoneOnSite : null,
    otherPhones: [...other.values()].map((entry) => ({ phone: entry.phone, pages: entry.pages.size })).sort((a, b) => b.pages - a.pages),
    listing: listings.map((listing) => ({ name: listing.name, mismatches: compareNap(truth, listing.subject) })),
  };
}
