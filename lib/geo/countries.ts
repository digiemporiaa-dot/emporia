/**
 * Countries, by ISO 3166-1 alpha-2 code.
 *
 * The list comes from the runtime's own CLDR data (`Intl.DisplayNames`), not
 * a table typed into this file, so no market is privileged and a new country
 * needs no code change. What is excluded is spelled out: the codes CLDR names
 * that are not countries (the EU, the UN, pseudo-locales), the
 * exceptionally reserved ones (Ascension, Canary Islands…) and the deprecated
 * aliases that would otherwise appear twice under one name (`UK` beside `GB`,
 * `SU` beside `RU`). Kosovo (`XK`) stays: it is the code Google and most
 * analytics tools use.
 *
 * Pure. The `Country` table holds only the countries something refers to;
 * this module is what decides whether a code is one.
 */

const NOT_COUNTRIES = new Set([
  // Groupings, organisations and placeholders.
  "EU", "EZ", "UN", "QO", "XA", "XB", "ZZ",
  // Exceptionally reserved — real places, but not ISO 3166-1 countries.
  "AC", "CP", "CQ", "DG", "EA", "IC", "TA",
  // Deprecated or transitional codes CLDR still names.
  "AN", "BU", "CS", "DD", "DY", "FX", "HV", "NH", "RH", "SU", "TP", "UK", "VD", "YD", "YU", "ZR",
]);

const CODE = /^[A-Z]{2}$/;

let cached: { code: string; name: string }[] | null = null;
let byName: Map<string, string> | null = null;

function displayNames(): Intl.DisplayNames {
  return new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });
}

/** Every country, sorted by English name. */
export function listCountries(): readonly { code: string; name: string }[] {
  if (cached) return cached;
  const names = displayNames();
  const out: { code: string; name: string }[] = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      if (NOT_COUNTRIES.has(code)) continue;
      const name = names.of(code);
      if (name && name !== code) out.push({ code, name });
    }
  }
  out.sort((x, y) => x.name.localeCompare(y.name, "en"));
  cached = out;
  return out;
}

export function isCountryCode(value: string): boolean {
  return CODE.test(value) && listCountries().some((country) => country.code === value);
}

/** The English name for a code, or null when it is not a country. */
export function countryName(code: string): string | null {
  return listCountries().find((country) => country.code === code)?.name ?? null;
}

/** Names people actually type that CLDR spells differently. */
const ALIASES: Record<string, string> = {
  uae: "AE",
  "u.a.e.": "AE",
  usa: "US",
  "u.s.": "US",
  "u.s.a.": "US",
  "united states of america": "US",
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  "south korea": "KR",
  "north korea": "KP",
  "hong kong": "HK",
  macau: "MO",
  macao: "MO",
  turkey: "TR",
  "czech republic": "CZ",
  "ivory coast": "CI",
  "cote d'ivoire": "CI",
  swaziland: "SZ",
  burma: "MM",
  myanmar: "MM",
  "east timor": "TL",
  "vatican": "VA",
};

const fold = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * The code for a country *name* — "India", "United Arab Emirates", "UAE" — or
 * null when the name is not recognised. Used to link the free-text
 * `City.country` to a `Country` row; an unrecognised name is left unlinked,
 * never guessed.
 */
export function countryCodeForName(name: string): string | null {
  const key = fold(name);
  if (!key) return null;
  if (ALIASES[key]) return ALIASES[key];
  if (CODE.test(name.trim().toUpperCase()) && isCountryCode(name.trim().toUpperCase())) {
    return name.trim().toUpperCase();
  }
  if (!byName) {
    byName = new Map();
    for (const country of listCountries()) {
      byName.set(fold(country.name), country.code);
      byName.set(fold(country.name.replace(/&/g, "and")), country.code);
    }
  }
  return byName.get(key) ?? byName.get(key.replace(/&/g, "and")) ?? null;
}
