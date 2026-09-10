/**
 * Target keyword matching.
 *
 * Deliberately forgiving about form and strict about substance. "Digital
 * marketing agency" should match "Digital Marketing Agency in Gurgaon" and
 * "digital-marketing-agency" in a slug, because those are the same phrase to a
 * reader and to a search engine. It should not match "marketing" alone, because
 * a page about marketing is not a page about a digital marketing agency.
 *
 * No stemming and no synonyms. Both would make the checks feel clever and
 * behave unpredictably — an editor who cannot tell why a check passed cannot
 * act on it. Exact phrase, normalised.
 */

/** Lower-case, strip punctuation and separators, collapse whitespace. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    // Hyphens and underscores are word separators here, so a slug reads as a
    // phrase: `digital-marketing-agency` becomes `digital marketing agency`.
    .replace(/[-_/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Does this text contain the phrase, as a whole phrase rather than a fragment? */
export function containsPhrase(text: string, phrase: string): boolean {
  const haystack = normalise(text);
  const needle = normalise(phrase);
  if (!haystack || !needle) return false;
  // Padded so a phrase only matches at word boundaries: "seo" must not match
  // inside "seoul".
  return ` ${haystack} `.includes(` ${needle} `);
}

/** How many times the phrase occurs. Overlapping matches are not counted twice. */
export function countPhrase(text: string, phrase: string): number {
  const haystack = normalise(text);
  const needle = normalise(phrase);
  if (!haystack || !needle) return 0;

  let count = 0;
  let from = 0;
  const padded = ` ${haystack} `;
  const target = ` ${needle} `;
  for (;;) {
    const at = padded.indexOf(target, from);
    if (at === -1) break;
    count += 1;
    // Step to just before the trailing space, so two adjacent occurrences —
    // which share that space — are both found.
    from = at + target.length - 1;
  }
  return count;
}

/**
 * Keyword density as a percentage of the page's words.
 *
 * Measured against the words the phrase itself occupies, not against
 * occurrences, so a three-word phrase used five times on a 300-word page reads
 * as 5%, not 1.7%. That is what "density" means to anyone reading the number.
 */
export function density(text: string, phrase: string, words: number): number {
  if (words === 0) return 0;
  const phraseWords = normalise(phrase).split(" ").filter(Boolean).length;
  if (phraseWords === 0) return 0;
  return (countPhrase(text, phrase) * phraseWords * 100) / words;
}
