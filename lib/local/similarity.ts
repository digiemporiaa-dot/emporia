/**
 * Near-duplicate detection for local content.
 *
 * This is what actually stops templated mass-publishing. A word-count minimum
 * is trivially satisfied by taking one city's intro and swapping the place name
 * — which is precisely the pattern CLAUDE.md 9 forbids — so publishing also
 * compares a page against its siblings for the same service.
 *
 * Method: normalise, strip the place names that are *supposed* to differ, then
 * compare word shingles by Jaccard similarity. Shingles rather than bag-of-words
 * because word order is what survives a find-and-replace.
 */

const SHINGLE_SIZE = 4;

/** Lowercase, strip punctuation, collapse whitespace. */
export function normaliseText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove the tokens that legitimately differ between two local pages, so the
 * comparison is about the substance rather than the place name.
 */
export function stripLocalTokens(input: string, tokens: readonly string[]): string {
  let output = normaliseText(input);
  for (const token of tokens) {
    const normalised = normaliseText(token);
    if (!normalised) continue;
    output = output.replaceAll(normalised, " ");
  }
  return output.replace(/\s+/g, " ").trim();
}

export function wordCount(input: string): number {
  const normalised = normaliseText(input);
  return normalised ? normalised.split(" ").length : 0;
}

function shingles(text: string, size = SHINGLE_SIZE): Set<string> {
  const words = text.split(" ").filter(Boolean);
  if (words.length === 0) return new Set();
  if (words.length <= size) return new Set([words.join(" ")]);

  const set = new Set<string>();
  for (let i = 0; i <= words.length - size; i += 1) {
    set.add(words.slice(i, i + size).join(" "));
  }
  return set;
}

/**
 * Jaccard similarity of two texts, 0 to 1.
 *
 * `localTokens` are removed from both sides first — typically the two city
 * names and states, so "SEO in Gurgaon" and "SEO in Mumbai" compare as
 * identical rather than merely similar.
 */
export function similarity(a: string, b: string, localTokens: readonly string[] = []): number {
  const left = shingles(stripLocalTokens(a, localTokens));
  const right = shingles(stripLocalTokens(b, localTokens));

  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const shingle of left) {
    if (right.has(shingle)) intersection += 1;
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Above this, two local pages are treated as the same page with a name swapped. */
export const DUPLICATE_THRESHOLD = 0.7;

export function isNearDuplicate(
  a: string,
  b: string,
  localTokens: readonly string[] = [],
  threshold = DUPLICATE_THRESHOLD,
): boolean {
  return similarity(a, b, localTokens) >= threshold;
}
