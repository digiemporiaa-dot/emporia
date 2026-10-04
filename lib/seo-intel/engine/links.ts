/**
 * Internal link suggestions. Pure.
 *
 * A target is a page ranking 4–20 for a query; a source is another crawled
 * page whose text contains that query as a phrase and does not link to the
 * target yet. The query becomes the suggested link text. Sources Google sends
 * more clicks to are preferred: a link from a page that is itself visited
 * carries more weight.
 */

export type LinkTarget = { url: string; query: string; position: number; impressions: number };
export type LinkSource = { url: string; text: string; clicks: number; inlinks: number };
export type Suggestion = {
  target: string;
  source: string;
  query: string;
  snippet: string;
  position: number;
  impressions: number;
  sourceClicks: number;
};

export const MAX_TARGETS = 100;
export const QUERIES_PER_PAGE = 3;
export const SOURCES_PER_TARGET = 5;
const SNIPPET_RADIUS = 90;

const WORD = /[\p{L}\p{N}]+/gu;

function tokens(text: string): string[] {
  return text.normalize("NFKC").toLowerCase().match(WORD) ?? [];
}

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The query's words in order, separated by anything that is not a letter or digit, not inside a longer word. */
function phrase(queryWords: string[]): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${queryWords.map(escape).join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])`, "iu");
}

function snippetAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/**
 * @param linked "from\nto" pairs of links that already exist.
 */
export function suggestLinks(targets: readonly LinkTarget[], sources: readonly LinkSource[], linked: ReadonlySet<string>): Suggestion[] {
  // Word → pages containing it, so each query only checks pages that hold all its words.
  const normalised = sources.map((source) => source.text.normalize("NFKC"));
  const index = new Map<string, Set<number>>();
  normalised.forEach((text, i) => {
    for (const word of new Set(tokens(text))) {
      let set = index.get(word);
      if (!set) index.set(word, (set = new Set()));
      set.add(i);
    }
  });

  // The strongest queries first, at most a few per page so one page cannot take every slot.
  const perPage = new Map<string, number>();
  const chosen = [...targets]
    .sort((a, b) => b.impressions - a.impressions)
    .filter((target) => {
      const count = perPage.get(target.url) ?? 0;
      if (count >= QUERIES_PER_PAGE) return false;
      perPage.set(target.url, count + 1);
      return true;
    })
    .slice(0, MAX_TARGETS);

  const inlinksOf = new Map(sources.map((source) => [source.url, source.inlinks]));
  const out: Suggestion[] = [];
  const used = new Set<string>();
  for (const target of chosen) {
    const words = tokens(target.query);
    if (!words.length) continue;
    let candidates: number[] | null = null;
    for (const word of words) {
      const set = index.get(word);
      if (!set) {
        candidates = [];
        break;
      }
      candidates = candidates === null ? [...set] : candidates.filter((i) => set.has(i));
    }
    const pattern = phrase(words);
    const matches: Suggestion[] = [];
    for (const i of candidates ?? []) {
      const source = sources[i] as LinkSource;
      if (source.url === target.url || linked.has(`${source.url}\n${target.url}`) || used.has(`${source.url}\n${target.url}`)) continue;
      const text = normalised[i] as string;
      const match = pattern.exec(text);
      if (!match) continue;
      matches.push({
        target: target.url,
        source: source.url,
        query: target.query,
        snippet: snippetAt(text, match.index, match[0].length),
        position: target.position,
        impressions: target.impressions,
        sourceClicks: source.clicks,
      });
    }
    matches
      .sort((a, b) => b.sourceClicks - a.sourceClicks || (inlinksOf.get(b.source) ?? 0) - (inlinksOf.get(a.source) ?? 0))
      .slice(0, SOURCES_PER_TARGET)
      .forEach((suggestion) => {
        used.add(`${suggestion.source}\n${suggestion.target}`);
        out.push(suggestion);
      });
  }
  return out;
}
