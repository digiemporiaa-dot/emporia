import { inlineToText } from "@/lib/content/inline";
import { isBlockType } from "@/lib/content/blocks";

/**
 * Plain text and link extraction from section content.
 *
 * The SEO analyzer needs to know how much a page actually says and what it
 * links to, and neither question can be answered from the JSON shape alone.
 * Kept pure and free of database access so it can be unit tested directly and
 * reused by anything that needs a page's words.
 */

/** Fields that hold prose written in the markdown-lite dialect. */
const RICH_FIELDS = new Set(["body", "answer"]);
/** Fields that hold plain prose. */
const PLAIN_FIELDS = new Set([
  "text",
  "heading",
  "title",
  "eyebrow",
  "caption",
  "question",
  "ctaLabel",
  "secondaryLabel",
]);

function walk(value: unknown, out: { text: string[]; links: string[] }): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, out);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") {
      if (RICH_FIELDS.has(key)) out.text.push(inlineToText(raw));
      else if (PLAIN_FIELDS.has(key)) out.text.push(raw);
      else if (key === "href" || key === "ctaHref" || key === "secondaryHref") out.links.push(raw);
      continue;
    }
    // `items`, `rows`, `headers`, `bullets` — the repeating shapes.
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string") out.text.push(item);
        else walk(item, out);
      }
      continue;
    }
    walk(raw, out);
  }
}

export type SectionText = { text: string; links: string[] };

/** Words and internal links a single section contributes to the page. */
export function sectionText(type: string, content: unknown): SectionText {
  if (!isBlockType(type)) {
    // Bespoke bands still contribute words; they just have no declared field
    // map, so the generic walk covers them on a best-effort basis.
    const out = { text: [] as string[], links: [] as string[] };
    walk(content, out);
    return { text: out.text.join(" ").trim(), links: out.links };
  }

  const out = { text: [] as string[], links: [] as string[] };
  walk(content, out);
  return { text: out.text.join(" ").trim(), links: out.links };
}

/** Rough word count. Good enough to tell 40 words from 400, which is the job. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Also picks up links written inline in rich text, which `walk` cannot see. */
export function inlineLinks(body: string): string[] {
  return [...body.matchAll(/\[[^\]]+\]\((\/[^)\s]*)\)/g)].map((match) => match[1] ?? "");
}
