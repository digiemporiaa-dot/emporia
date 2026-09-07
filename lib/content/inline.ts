/**
 * Markdown-lite for CMS rich text.
 *
 * The rich-text block stores what the editor typed and this turns it into a
 * structure the renderer walks to emit React elements. Deliberately not HTML:
 * nothing in this path is ever handed to `dangerouslySetInnerHTML`, so there is
 * no sanitiser to keep current and no stored-XSS surface (CLAUDE.md 11).
 *
 * Supported, and no more:
 *   **bold**            *italic*            [text](/path)
 *   blank line          new paragraph
 *
 * Anything else — including an unclosed marker — is literal text. Nesting is
 * not supported: `**bold *and* italic**` renders the inner asterisks as
 * characters. That is a deliberate limit, not a bug to work around; a builder
 * that needs more should get more block types, not a richer mini-language.
 */

export type Span = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Always an internal path. External links are rendered as plain text. */
  href?: string;
};

export type Paragraph = { spans: Span[] };

/**
 * Emphasis markers must hug their content — `*italic*`, never `a * b`. Without
 * that, an asterisk used as a bullet or a multiplication sign silently turns
 * the rest of the sentence italic.
 */
const EMPHASIS = String.raw`\S(?:[^*]*\S)?`;
const TOKEN = new RegExp(
  String.raw`\*\*(${EMPHASIS})\*\*|\*(${EMPHASIS})\*|\[([^\]]+)\]\(([^)\s]+)\)`,
  "g",
);

function parseParagraph(text: string): Span[] {
  const spans: Span[] = [];
  let cursor = 0;

  for (const match of text.matchAll(TOKEN)) {
    const index = match.index;
    if (index > cursor) spans.push({ text: text.slice(cursor, index) });

    const [, bold, italic, linkText, href] = match;

    if (bold !== undefined) {
      spans.push({ text: bold, bold: true });
    } else if (italic !== undefined) {
      spans.push({ text: italic, italic: true });
    } else if (linkText !== undefined && href !== undefined) {
      // Only internal paths become links. A pasted external URL renders as the
      // text it is rather than silently becoming an outbound link an editor
      // did not realise they were publishing.
      if (href.startsWith("/")) spans.push({ text: linkText, href });
      else spans.push({ text: linkText });
    }

    cursor = index + match[0].length;
  }

  if (cursor < text.length) spans.push({ text: text.slice(cursor) });
  return spans.filter((span) => span.text.length > 0);
}

export function parseInline(body: string): Paragraph[] {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => ({ spans: parseParagraph(block.replace(/\s*\n\s*/g, " ")) }))
    .filter((paragraph) => paragraph.spans.length > 0);
}

/** Plain text of a body, for previews, summaries and SEO word counts. */
export function inlineToText(body: string): string {
  return parseInline(body)
    .map((paragraph) => paragraph.spans.map((span) => span.text).join(""))
    .join("\n\n");
}
