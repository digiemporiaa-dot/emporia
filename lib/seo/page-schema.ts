import "server-only";
import { breadcrumbSchema } from "@/lib/seo/breadcrumbs";
import { faqSchema } from "@/lib/seo/schema";
import { inlineToText } from "@/lib/content/inline";
import type { ParsedSection } from "@/lib/content/sections";

/**
 * Structured data for a CMS page.
 *
 * Emitted only where the page genuinely contains that content (CLAUDE.md 9).
 * The FAQ nodes come from the page's own FAQ blocks, not from a field an
 * editor filled in separately — so the markup and the visible page cannot
 * disagree, which is the thing that gets structured data penalised.
 *
 * The schema type on the Seo record is a gate, not a source: an editor opting
 * in is what turns the markup on, and the blocks are what fill it.
 */

export function faqSchemaForSections(
  sections: readonly ParsedSection[],
  schemaType: string | null | undefined,
): object | null {
  if (schemaType !== "FAQ_PAGE") return null;

  const items = sections
    .filter((section): section is Extract<ParsedSection, { type: "faq" }> => section.type === "faq")
    .flatMap((section) => section.content.items)
    .map((item) => ({
      question: item.question,
      // The answer is stored as markdown-lite; structured data wants the words.
      answer: inlineToText(item.answer),
    }))
    .filter((item) => item.question.trim() && item.answer.trim());

  return faqSchema(items);
}

/** Breadcrumbs for a top-level CMS page: Home, then the page. */
export function pageBreadcrumbs(title: string, slug: string): object | null {
  return breadcrumbSchema([
    { name: "Home", path: "/" },
    { name: title, path: `/${slug}` },
  ]);
}
