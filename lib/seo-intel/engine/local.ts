/**
 * Local coverage: which page serves each service in each city, and how much
 * search demand there is for that combination (Phase 8). Pure.
 *
 * A page "serves" a cell when its URL, title or H1 names both the city and
 * the service; staff can replace any automatic match with a page they choose.
 * Demand is the Search Console queries naming both. Words are compared whole,
 * after folding case, accents and punctuation, so "seo-delhi" matches the
 * city "Delhi" and the term "seo", while "delhite" does not.
 */

export type CoveragePage = {
  url: string;
  title: string | null;
  h1: string | null;
  statusCode: number | null;
  indexable: boolean | null;
  inlinks: number;
};

export type CoverageService = { id: string; name: string; terms: string[] };
export type CoverageCity = { id: string; name: string; slug: string; aliases: string[] };
export type QueryRow = { query: string; clicks: number; impressions: number };

export type MatchHow = "url" | "title" | "mixed" | "chosen" | "cms";

export type CellMatch = {
  serviceId: string;
  cityId: string;
  page: { url: string; how: MatchHow } | null;
  demand: { clicks: number; impressions: number; queries: { query: string; impressions: number; clicks: number }[] };
};

/** Lower case, no accents, every run of non-letters and digits one space, padded. */
export function fold(text: string): string {
  const folded = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return folded ? ` ${folded} ` : " ";
}

/** Whether folded text contains the phrase as whole words. */
export function hasPhrase(folded: string, phrase: string): boolean {
  const needle = fold(phrase);
  return needle !== " " && folded.includes(needle);
}

/** The words of a URL's path, decoded: "/seo-services/new-delhi/" → " seo services new delhi ". */
export function pathWords(url: string): string {
  try {
    const { pathname } = new URL(url);
    let decoded = pathname;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      // Malformed escapes: compare the raw path.
    }
    return fold(decoded);
  } catch {
    return " ";
  }
}

export function cityTerms(city: CoverageCity): string[] {
  return unique([city.name, city.slug.replace(/[-_]+/g, " "), ...city.aliases]);
}

export function serviceTerms(service: CoverageService): string[] {
  return unique(service.terms.length ? service.terms : [service.name]);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = fold(value);
    if (key === " " || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

const anyIn = (folded: string, terms: string[]) => terms.some((term) => hasPhrase(folded, term));

type Prepared = { page: CoveragePage; path: string; text: string };

/**
 * Every cell for every service × city. `chosen` holds staff choices and
 * `cms` the agency's own Service × City URLs, keyed "serviceId:cityId";
 * a staff choice wins over the CMS, which wins over a guess.
 */
export function matchCoverage(input: {
  services: CoverageService[];
  cities: CoverageCity[];
  pages: CoveragePage[];
  queries: QueryRow[];
  chosen?: Map<string, string>;
  cms?: Map<string, string>;
}): CellMatch[] {
  const pages: Prepared[] = input.pages
    .filter((page) => page.statusCode === 200)
    .map((page) => ({ page, path: pathWords(page.url), text: fold(`${page.title ?? ""} ${page.h1 ?? ""}`) }));
  const queries = input.queries.map((row) => ({ row, folded: fold(row.query) }));

  // Index once per city and per service; a cell is then an intersection.
  const cityIndex = new Map(
    input.cities.map((city) => {
      const terms = cityTerms(city);
      return [city.id, {
        path: new Set(pages.filter((p) => anyIn(p.path, terms)).map((p) => p.page.url)),
        text: new Set(pages.filter((p) => anyIn(p.text, terms)).map((p) => p.page.url)),
        queries: new Set(queries.filter((q) => anyIn(q.folded, terms)).map((q) => q.row.query)),
      }];
    }),
  );
  const serviceIndex = new Map(
    input.services.map((service) => {
      const terms = serviceTerms(service);
      return [service.id, {
        path: new Set(pages.filter((p) => anyIn(p.path, terms)).map((p) => p.page.url)),
        text: new Set(pages.filter((p) => anyIn(p.text, terms)).map((p) => p.page.url)),
        queries: new Set(queries.filter((q) => anyIn(q.folded, terms)).map((q) => q.row.query)),
      }];
    }),
  );

  const cells: CellMatch[] = [];
  for (const city of input.cities) {
    const c = cityIndex.get(city.id)!;
    for (const service of input.services) {
      const s = serviceIndex.get(service.id)!;
      const key = `${service.id}:${city.id}`;

      let page: CellMatch["page"] = null;
      const chosen = input.chosen?.get(key);
      const cms = input.cms?.get(key);
      if (chosen) page = { url: chosen, how: "chosen" };
      else if (cms) page = { url: cms, how: "cms" };
      else {
        let best: { prepared: Prepared; score: number } | null = null;
        for (const prepared of pages) {
          const url = prepared.page.url;
          const score =
            c.path.has(url) && s.path.has(url) ? 3
            : c.text.has(url) && s.text.has(url) ? 2
            : (c.path.has(url) || c.text.has(url)) && (s.path.has(url) || s.text.has(url)) ? 1
            : 0;
          if (score && (!best || better({ prepared, score }, best))) best = { prepared, score };
        }
        if (best) page = { url: best.prepared.page.url, how: best.score === 3 ? "url" : best.score === 2 ? "title" : "mixed" };
      }

      const matched = queries.filter((q) => c.queries.has(q.row.query) && s.queries.has(q.row.query)).map((q) => q.row);
      matched.sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
      cells.push({
        serviceId: service.id,
        cityId: city.id,
        page,
        demand: {
          clicks: matched.reduce((sum, row) => sum + row.clicks, 0),
          impressions: matched.reduce((sum, row) => sum + row.impressions, 0),
          queries: matched.slice(0, 5).map((row) => ({ query: row.query, impressions: row.impressions, clicks: row.clicks })),
        },
      });
    }
  }
  return cells;
}

/** Higher score, then indexable, then more internal links, then the shorter URL. */
function better(a: { prepared: Prepared; score: number }, b: { prepared: Prepared; score: number }): boolean {
  if (a.score !== b.score) return a.score > b.score;
  const ai = a.prepared.page.indexable === true ? 1 : 0;
  const bi = b.prepared.page.indexable === true ? 1 : 0;
  if (ai !== bi) return ai > bi;
  if (a.prepared.page.inlinks !== b.prepared.page.inlinks) return a.prepared.page.inlinks > b.prepared.page.inlinks;
  if (a.prepared.page.url.length !== b.prepared.page.url.length) return a.prepared.page.url.length < b.prepared.page.url.length;
  return a.prepared.page.url < b.prepared.page.url;
}

export type CellStatus = "covered" | "not-indexable" | "not-crawled" | "draft" | "gap";

/**
 * What a cell needs. `crawled` is the page in the latest crawl, if it was
 * fetched; `cmsStatus` the agency CMS page's status, when there is one.
 */
export function cellStatus(input: {
  page: CellMatch["page"];
  crawled: { statusCode: number | null; indexable: boolean | null } | null;
  cmsStatus?: "DRAFT" | "PUBLISHED" | "ARCHIVED" | null;
}): CellStatus {
  if (!input.page) return input.cmsStatus ? "draft" : "gap";
  if (input.page.how === "cms" && input.cmsStatus !== "PUBLISHED") return "draft";
  if (!input.crawled) return "not-crawled";
  return input.crawled.statusCode === 200 && input.crawled.indexable === true ? "covered" : "not-indexable";
}

export const LOCAL_SERVICES_CAP = 30;
export const LOCAL_CITIES_CAP = 200;
export const TERMS_CAP = 10;
export const ALIASES_CAP = 5;

/**
 * Comma- or line-separated words, lower-cased, deduplicated after folding.
 * Each must be 2–80 characters; anything else is returned as rejected.
 */
export function parseTerms(text: string, max: number): { terms: string[]; rejected: string[] } {
  const terms: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,\n]/)) {
    const term = raw.trim().replace(/\s+/g, " ").toLowerCase();
    if (!term) continue;
    if (term.length < 2 || term.length > 80 || fold(term) === " ") {
      rejected.push(raw.trim());
      continue;
    }
    const key = fold(term);
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  if (terms.length > max) rejected.push(...terms.splice(max));
  return { terms, rejected };
}

/** Terms for a CMS service: its name, and the name without a trailing "services". */
export function termsFromServiceName(name: string): string[] {
  const lower = name.trim().replace(/\s+/g, " ").toLowerCase();
  const stem = lower.replace(/\s+(services?|solutions?)$/, "");
  return stem && stem !== lower ? [lower, stem] : [lower];
}
