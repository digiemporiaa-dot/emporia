/**
 * Starter text: copy laid down by a fresh install that someone must replace.
 *
 * Every starter paragraph begins with STARTER_MARKER, and a page holding the
 * marker anywhere cannot be published (page.service `setPageStatus`), so a
 * placeholder privacy policy can never go live by accident. Pure.
 */

export const STARTER_MARKER = "[Replace before publishing]";

/** How many of these sections still carry starter text. */
export function starterSectionCount(sections: readonly { content: unknown }[]): number {
  return sections.filter((section) => JSON.stringify(section.content ?? null).includes(STARTER_MARKER)).length;
}

/** The path a navigation link points at on this site, normalised, or null for anything external. */
export function internalPath(href: string): string | null {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const path = href.split(/[?#]/)[0] ?? "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : "/";
}
