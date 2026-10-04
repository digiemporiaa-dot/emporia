import { areLocaleVariants, checkHreflang, primaryLanguage } from "@/lib/seo-intel/engine/international";

/**
 * Technical SEO rules over one finished crawl. Pure: the crawl service loads
 * the pages, this decides what is wrong, the service stores the findings.
 *
 * Every finding names a rule from RULES, so the screens explain each one the
 * same way, and carries its evidence in `detail`.
 */

export type Severity = "CRITICAL" | "WARNING" | "NOTICE";

export type RuleKey =
  | "http-4xx"
  | "http-5xx"
  | "fetch-error"
  | "redirect-loop"
  | "redirect-chain"
  | "internal-redirect"
  | "noindex-in-sitemap"
  | "canonical-to-error"
  | "title-missing"
  | "title-duplicate"
  | "title-too-long"
  | "description-missing"
  | "description-duplicate"
  | "description-too-long"
  | "h1-missing"
  | "h1-multiple"
  | "content-duplicate"
  | "thin-content"
  | "orphan-page"
  | "deep-page"
  | "slow-response"
  | "images-missing-alt"
  | "hreflang-no-return"
  | "hreflang-invalid"
  | "hreflang-duplicate-code"
  | "hreflang-no-self"
  | "hreflang-to-broken"
  | "hreflang-canonical-conflict"
  | "hreflang-lang-mismatch"
  | "country-duplicate"
  | "blocked-by-robots"
  | "lang-missing";

export const RULES: Record<RuleKey, { severity: Severity; title: string; why: string }> = {
  "http-4xx": { severity: "CRITICAL", title: "Broken page (4xx)", why: "Linked from the site or listed in the sitemap, but the server says it does not exist. Visitors and Google hit a dead end." },
  "http-5xx": { severity: "CRITICAL", title: "Server error (5xx)", why: "The server failed to produce the page. Repeated errors make Google crawl less and can drop the page." },
  "fetch-error": { severity: "CRITICAL", title: "Could not be fetched", why: "The request timed out, was refused or was too large, so neither the crawler nor, likely, Google could read it." },
  "redirect-loop": { severity: "CRITICAL", title: "Redirect loop", why: "The redirects lead back to themselves; the page can never load." },
  "redirect-chain": { severity: "WARNING", title: "Redirect chain", why: "More than one redirect before the final page. Each hop slows visitors and wastes crawl budget; link to the final URL." },
  "internal-redirect": { severity: "NOTICE", title: "Internal link to a redirect", why: "The site links to a URL that redirects. Pointing the link at the final URL saves a hop." },
  "noindex-in-sitemap": { severity: "WARNING", title: "Noindex page in the sitemap", why: "The sitemap asks Google to index a page that tells Google not to. Remove one of the two signals." },
  "canonical-to-error": { severity: "WARNING", title: "Canonical points to a broken or redirecting URL", why: "The page names a preferred URL that does not load directly, so Google may ignore the canonical." },
  "title-missing": { severity: "WARNING", title: "Missing title", why: "The title is the headline in search results; without one Google writes its own." },
  "title-duplicate": { severity: "WARNING", title: "Duplicate title", why: "Several indexable pages share a title, so searchers and Google cannot tell them apart." },
  "title-too-long": { severity: "NOTICE", title: "Long title", why: "Over 60 characters; search results usually cut it off." },
  "description-missing": { severity: "NOTICE", title: "Missing meta description", why: "Google writes its own snippet, which may not sell the page." },
  "description-duplicate": { severity: "NOTICE", title: "Duplicate meta description", why: "Several indexable pages share a description." },
  "description-too-long": { severity: "NOTICE", title: "Long meta description", why: "Over 160 characters; search results usually cut it off." },
  "h1-missing": { severity: "WARNING", title: "Missing H1", why: "No main heading in the HTML. It is the clearest statement of what the page is about." },
  "h1-multiple": { severity: "NOTICE", title: "More than one H1", why: "Several main headings dilute what the page is about." },
  "content-duplicate": { severity: "WARNING", title: "Duplicate content", why: "Indexable pages with identical text compete with each other; Google picks one and may ignore the rest." },
  "thin-content": { severity: "NOTICE", title: "Thin content", why: "Fewer than 200 words in the HTML. Pages built by JavaScript can look thin to this crawler; check before acting." },
  "orphan-page": { severity: "WARNING", title: "Orphan page", why: "In the sitemap but no crawled page links to it, so visitors cannot reach it and Google sees it as unimportant." },
  "deep-page": { severity: "NOTICE", title: "Deep page", why: "More than four clicks from the home page; deep pages are crawled less often." },
  "slow-response": { severity: "NOTICE", title: "Slow server response", why: "The HTML took over 1.5 seconds to arrive, before anything else on the page loaded." },
  "images-missing-alt": { severity: "NOTICE", title: "Images without alt text", why: "Images with no alt attribute are invisible to screen readers and to image search." },
  "hreflang-no-return": { severity: "WARNING", title: "Hreflang without a return link", why: "This page names an alternate language version that does not name it back, so Google ignores the pair." },
  "hreflang-invalid": { severity: "WARNING", title: "Invalid hreflang code", why: "Google only reads ISO 639-1 languages with an optional ISO 3166-1 country (en, en-GB) or x-default. Other codes are ignored." },
  "hreflang-duplicate-code": { severity: "WARNING", title: "Hreflang code used twice", why: "The same language or country code points to two different URLs, so Google cannot tell which one to show." },
  "hreflang-no-self": { severity: "NOTICE", title: "Hreflang does not include the page itself", why: "Each page in a language set should list itself too; without it the set is incomplete." },
  "hreflang-to-broken": { severity: "WARNING", title: "Hreflang points to a page that does not load or is noindex", why: "Alternate versions must load directly and be indexable, or Google drops them from the set." },
  "hreflang-canonical-conflict": { severity: "WARNING", title: "Hreflang and canonical disagree", why: "Hreflang should only connect canonical URLs. A page that names another URL as canonical, or an alternate that does, sends Google mixed signals." },
  "hreflang-lang-mismatch": { severity: "NOTICE", title: "Page language differs from its hreflang", why: "The <html lang> attribute names a different language from the one the page's own hreflang entry declares." },
  "country-duplicate": { severity: "WARNING", title: "Country versions with identical content and no hreflang", why: "The same page under different country or language paths, with no hreflang linking them. Google treats them as duplicates and may show the wrong country's page." },
  "blocked-by-robots": { severity: "NOTICE", title: "Blocked by robots.txt", why: "Linked or listed, but robots.txt stops crawlers reading it. Fine if intended." },
  "lang-missing": { severity: "NOTICE", title: "No language declared", why: "The <html> element has no lang attribute." },
};

export type RulePage = {
  url: string;
  state: "QUEUED" | "FETCHED" | "BLOCKED" | "ERROR";
  depth: number;
  statusCode: number | null;
  redirectTo: string | null;
  contentType: string | null;
  responseMs: number | null;
  canonical: string | null;
  noindex: boolean;
  title: string | null;
  description: string | null;
  h1Count: number | null;
  wordCount: number | null;
  contentHash: string | null;
  lang: string | null;
  hreflang: { lang: string; href: string }[];
  imagesMissingAlt: number | null;
  inSitemap: boolean;
  inlinks: number;
  error: string | null;
};

export type RuleLink = { from: string; to: string };

export type Finding = { url: string; rule: RuleKey; severity: Severity; detail?: Record<string, unknown> };

const isHtml = (page: RulePage) => page.statusCode === 200 && !!page.contentType && /html/i.test(page.contentType);
const isIndexable = (page: RulePage) =>
  isHtml(page) && !page.noindex && (!page.canonical || page.canonical === page.url);

function find(rule: RuleKey, url: string, detail?: Record<string, unknown>): Finding {
  return { url, rule, severity: RULES[rule].severity, ...(detail ? { detail } : {}) };
}

/** Pages sharing a value, grouped; only groups of two or more. */
function duplicates(pages: RulePage[], key: (page: RulePage) => string | null): RulePage[][] {
  const groups = new Map<string, RulePage[]>();
  for (const page of pages) {
    const value = key(page);
    if (!value) continue;
    const list = groups.get(value) ?? [];
    list.push(page);
    groups.set(value, list);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function technicalFindings(pages: RulePage[], links: RuleLink[]): Finding[] {
  const findings: Finding[] = [];
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const sourcesOf = new Map<string, string[]>();
  for (const link of links) {
    const list = sourcesOf.get(link.to) ?? [];
    if (list.length < 5) list.push(link.from);
    sourcesOf.set(link.to, list);
  }
  const linkedFrom = (url: string) => sourcesOf.get(url) ?? [];

  for (const page of pages) {
    if (page.state === "ERROR") {
      findings.push(find("fetch-error", page.url, { error: page.error, linkedFrom: linkedFrom(page.url) }));
      continue;
    }
    if (page.state === "BLOCKED") {
      findings.push(find("blocked-by-robots", page.url, { linkedFrom: linkedFrom(page.url), inSitemap: page.inSitemap }));
      continue;
    }
    if (page.state !== "FETCHED" || page.statusCode === null) continue;

    if (page.statusCode >= 400 && page.statusCode < 500) {
      findings.push(find("http-4xx", page.url, { status: page.statusCode, linkedFrom: linkedFrom(page.url), inSitemap: page.inSitemap }));
    } else if (page.statusCode >= 500) {
      findings.push(find("http-5xx", page.url, { status: page.statusCode, linkedFrom: linkedFrom(page.url), inSitemap: page.inSitemap }));
    }

    if (page.statusCode >= 300 && page.statusCode < 400 && page.redirectTo) {
      const chain = [page.url];
      let current: RulePage | undefined = page;
      let loop = false;
      while (current && current.statusCode !== null && current.statusCode >= 300 && current.statusCode < 400 && current.redirectTo) {
        if (chain.includes(current.redirectTo)) {
          loop = true;
          chain.push(current.redirectTo);
          break;
        }
        chain.push(current.redirectTo);
        if (chain.length > 10) break;
        current = byUrl.get(current.redirectTo);
      }
      if (loop) findings.push(find("redirect-loop", page.url, { chain }));
      else if (chain.length > 2) findings.push(find("redirect-chain", page.url, { chain, hops: chain.length - 1 }));
      if (page.inlinks > 0) findings.push(find("internal-redirect", page.url, { target: page.redirectTo, linkedFrom: linkedFrom(page.url) }));
    }

    if (page.responseMs !== null && page.responseMs > 1_500) {
      findings.push(find("slow-response", page.url, { ms: page.responseMs }));
    }

    if (!isHtml(page)) continue;

    if (page.noindex && page.inSitemap) findings.push(find("noindex-in-sitemap", page.url));

    if (page.canonical && page.canonical !== page.url) {
      const target = byUrl.get(page.canonical);
      if (target && target.state === "FETCHED" && target.statusCode !== 200) {
        findings.push(find("canonical-to-error", page.url, { canonical: page.canonical, status: target.statusCode }));
      }
    }

    if (page.noindex) continue;

    if (!page.title) findings.push(find("title-missing", page.url));
    else if (page.title.length > 60) findings.push(find("title-too-long", page.url, { length: page.title.length, title: page.title }));
    if (!page.description) findings.push(find("description-missing", page.url));
    else if (page.description.length > 160) findings.push(find("description-too-long", page.url, { length: page.description.length }));
    if (!page.h1Count) findings.push(find("h1-missing", page.url));
    else if (page.h1Count > 1) findings.push(find("h1-multiple", page.url, { count: page.h1Count }));
    if (page.wordCount !== null && page.wordCount < 200) findings.push(find("thin-content", page.url, { words: page.wordCount }));
    if (page.imagesMissingAlt) findings.push(find("images-missing-alt", page.url, { count: page.imagesMissingAlt }));
    if (!page.lang) findings.push(find("lang-missing", page.url));
    if (page.inSitemap && page.inlinks === 0 && page.depth !== 0) findings.push(find("orphan-page", page.url));
    if (page.depth > 4) findings.push(find("deep-page", page.url, { depth: page.depth }));

    for (const alternate of page.hreflang) {
      if (alternate.href === page.url) continue;
      const other = byUrl.get(alternate.href);
      if (other && isHtml(other) && !other.hreflang.some((back) => back.href === page.url)) {
        findings.push(find("hreflang-no-return", page.url, { alternate: alternate.href, lang: alternate.lang }));
      }
    }
    if (page.hreflang.length) findings.push(...hreflangFindings(page, byUrl));
  }

  const indexable = pages.filter(isIndexable);
  for (const [rule, key] of [
    ["title-duplicate", (page: RulePage) => page.title?.toLowerCase() ?? null],
    ["description-duplicate", (page: RulePage) => page.description?.toLowerCase() ?? null],
    ["content-duplicate", (page: RulePage) => page.contentHash],
  ] as const) {
    for (const group of duplicates(indexable, key)) {
      for (const page of group) {
        if (rule === "content-duplicate") {
          findings.push(...contentDuplicateFindings(page, group));
          continue;
        }
        // Versions tied together by hreflang may share a title or description.
        const others = group.filter((other) => other !== page && !linkedByHreflang(page, other)).map((other) => other.url);
        if (others.length) findings.push(find(rule, page.url, { duplicates: others.slice(0, 10), count: others.length + 1 }));
      }
    }
  }

  return findings;
}

const linkedByHreflang = (a: RulePage, b: RulePage) =>
  a.hreflang.some((entry) => entry.href === b.url) || b.hreflang.some((entry) => entry.href === a.url);

/**
 * Identical text is fine between versions that hreflang ties together;
 * between locale-path versions it does not tie, it is a country duplicate;
 * anywhere else it is plain duplicate content.
 */
function contentDuplicateFindings(page: RulePage, group: RulePage[]): Finding[] {
  const plain: string[] = [];
  const country: string[] = [];
  for (const other of group) {
    if (other === page || linkedByHreflang(page, other)) continue;
    if (areLocaleVariants(page.url, other.url)) country.push(other.url);
    else plain.push(other.url);
  }
  const out: Finding[] = [];
  if (plain.length) out.push(find("content-duplicate", page.url, { duplicates: plain.slice(0, 10), count: plain.length + 1 }));
  if (country.length) out.push(find("country-duplicate", page.url, { versions: country.slice(0, 10), count: country.length + 1 }));
  return out;
}

/** Hreflang checks for one indexable-or-not HTML page that declares a set. */
function hreflangFindings(page: RulePage, byUrl: Map<string, RulePage>): Finding[] {
  const out: Finding[] = [];
  const invalid: { lang: string; reason: string }[] = [];
  const targets = new Map<string, Set<string>>();
  for (const entry of page.hreflang) {
    const code = checkHreflang(entry.lang);
    if (!code.ok) invalid.push({ lang: entry.lang, reason: code.reason });
    const set = targets.get(entry.lang) ?? new Set<string>();
    set.add(entry.href);
    targets.set(entry.lang, set);
  }
  if (invalid.length) out.push(find("hreflang-invalid", page.url, { codes: invalid.slice(0, 10) }));

  const repeated = [...targets].filter(([, hrefs]) => hrefs.size > 1).map(([lang, hrefs]) => ({ lang, urls: [...hrefs].slice(0, 5) }));
  if (repeated.length) out.push(find("hreflang-duplicate-code", page.url, { codes: repeated.slice(0, 10) }));

  const self = page.hreflang.filter((entry) => entry.href === page.url);
  if (!self.length) out.push(find("hreflang-no-self", page.url));

  const broken: { url: string; lang: string; problem: string }[] = [];
  const otherCanonical: { url: string; canonical: string }[] = [];
  for (const entry of page.hreflang) {
    if (entry.href === page.url) continue;
    const other = byUrl.get(entry.href);
    if (!other || other.state === "QUEUED" || other.state === "BLOCKED") continue;
    if (other.state === "ERROR") broken.push({ url: entry.href, lang: entry.lang, problem: "could not be fetched" });
    else if (other.statusCode !== null && other.statusCode >= 300 && other.statusCode < 400) broken.push({ url: entry.href, lang: entry.lang, problem: "redirects" });
    else if (other.statusCode !== 200) broken.push({ url: entry.href, lang: entry.lang, problem: `returns ${other.statusCode}` });
    else if (other.noindex) broken.push({ url: entry.href, lang: entry.lang, problem: "is noindex" });
    else if (other.canonical && other.canonical !== other.url) otherCanonical.push({ url: entry.href, canonical: other.canonical });
  }
  if (broken.length) out.push(find("hreflang-to-broken", page.url, { alternates: broken.slice(0, 10) }));

  const ownCanonical = page.canonical && page.canonical !== page.url ? page.canonical : null;
  if (ownCanonical || otherCanonical.length) {
    out.push(find("hreflang-canonical-conflict", page.url, { canonical: ownCanonical, alternates: otherCanonical.slice(0, 10) }));
  }

  const declared = self.map((entry) => checkHreflang(entry.lang)).find((code) => code.ok && !code.xDefault);
  const htmlLanguage = primaryLanguage(page.lang);
  if (declared && declared.ok && !declared.xDefault && htmlLanguage && htmlLanguage !== declared.language) {
    out.push(find("hreflang-lang-mismatch", page.url, { lang: page.lang, hreflang: declared.language }));
  }
  return out;
}

/** Counts by severity, for the run summary. */
export function summarize(findings: Finding[]): Record<Severity, number> {
  const summary: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, NOTICE: 0 };
  for (const finding of findings) summary[finding.severity] += 1;
  return summary;
}
