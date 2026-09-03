/**
 * Template rendering.
 *
 * Substitution is `{{ name }}`, and every value is HTML-escaped on the way in.
 * Templates are edited by staff and filled with data that came from the public
 * internet — a lead's own message, a client's company name — so an unescaped
 * substitution would put attacker-controlled markup into an email we send under
 * our own domain.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "\'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"\']/g, (char) => ESCAPES[char] ?? char);
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** The variable names a template refers to, in order of first appearance. */
export function placeholdersIn(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/** Placeholders a template uses that the caller did not supply. */
export function missingVariables(
  template: string,
  variables: Record<string, string>,
): string[] {
  return placeholdersIn(template).filter((name) => variables[name] === undefined);
}

export type RenderOptions = {
  /** HTML-escape values. Off for the plain-text part, where escaping is wrong. */
  escape?: boolean;
};

export function render(
  template: string,
  variables: Record<string, string>,
  options: RenderOptions = {},
): string {
  const escape = options.escape ?? true;

  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = variables[name];
    // An unknown placeholder is left visible rather than silently emptied: a
    // template referring to a variable nobody supplies is a bug to notice.
    if (value === undefined) return `{{${name}}}`;
    return escape ? escapeHtml(value) : value;
  });
}

/**
 * A plain-text part derived from the HTML one.
 *
 * Not a full converter: it keeps link targets, turns block elements into line
 * breaks, and drops the rest. Every template also ships its own text version;
 * this is the fallback when someone edits the HTML and forgets.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) =>
      text.trim() && !text.includes(href) ? `${text.trim()} (${href})` : href,
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "\'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}
