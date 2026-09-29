/**
 * How long a post is, the way its platform counts.
 *
 * Shared by the editor's validation and the adapter, so a post that fits when
 * it is written is a post that fits when it is published.
 *
 * Most platforms count characters. X does not: every link counts as 23
 * (it is shortened to t.co whatever its real length), and characters outside
 * the Latin, Indic and common-punctuation ranges — emoji, CJK — count as two.
 * The ranges are twitter-text's published v3 configuration.
 */

export type LengthRule = "characters" | "x-weighted";

/** What X counts every link as, whatever its length. */
export const X_LINK_LENGTH = 23;

/** twitter-text v3: code point ranges weighted 1; everything else weighs 2. */
const X_LIGHT_RANGES: readonly [number, number][] = [
  [0, 4351],
  [8192, 8205],
  [8208, 8223],
  [8242, 8247],
];

const URL_PATTERN = /https?:\/\/[^\s]+/g;

export function textLength(text: string, rule: LengthRule = "characters"): number {
  if (rule === "characters") return text.length;

  let length = 0;
  const withoutLinks = text.replace(URL_PATTERN, () => {
    length += X_LINK_LENGTH;
    return "";
  });
  for (const char of withoutLinks) {
    const code = char.codePointAt(0)!;
    length += X_LIGHT_RANGES.some(([from, to]) => code >= from && code <= to) ? 1 : 2;
  }
  return length;
}
