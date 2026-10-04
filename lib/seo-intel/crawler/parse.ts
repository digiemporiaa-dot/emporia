import { createHash } from "node:crypto";
import { Parser } from "htmlparser2";
import { normalizeUrl } from "@/lib/seo-intel/crawler/url";

/**
 * What the crawler reads from one HTML page. Static HTML only: content a page
 * builds in the browser with JavaScript is not seen, and the screens say so.
 */
export type ParsedLink = { url: string; anchor: string; nofollow: boolean };

export type ParsedPage = {
  title: string | null;
  description: string | null;
  metaRobots: string | null;
  canonical: string | null;
  lang: string | null;
  hreflang: { lang: string; href: string }[];
  h1: string | null;
  h1Count: number;
  h2Count: number;
  wordCount: number;
  contentHash: string | null;
  schemaTypes: string[];
  imageCount: number;
  imagesMissingAlt: number;
  links: ParsedLink[];
};

const SKIP_TEXT = new Set(["script", "style", "noscript", "template", "svg", "head", "title"]);
const BLOCK = new Set(["p", "div", "li", "br", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "tr", "section", "article", "header", "footer", "nav", "main", "aside", "blockquote", "pre"]);
const MAX_LINKS = 1_000;
const MAX_TEXT = 2_000;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function cap(value: string | null, length = MAX_TEXT): string | null {
  if (value === null) return null;
  const cleaned = clean(value);
  return cleaned ? cleaned.slice(0, length) : null;
}

/** `@type` values from JSON-LD, following `@graph` and nested objects. */
function collectTypes(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 6 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectTypes(item, into, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") into.add(type);
  else if (Array.isArray(type)) for (const t of type) if (typeof t === "string") into.add(t);
  for (const [key, child] of Object.entries(record)) {
    if (key !== "@context") collectTypes(child, into, depth + 1);
  }
}

export function parsePage(html: string, pageUrl: string): ParsedPage {
  let base = pageUrl;
  let title: string | null = null;
  let titleBuffer: string | null = null;
  let description: string | null = null;
  const robots: string[] = [];
  let canonical: string | null = null;
  let lang: string | null = null;
  const hreflang: { lang: string; href: string }[] = [];
  let h1: string | null = null;
  let h1Buffer: string | null = null;
  let h1Count = 0;
  let h2Count = 0;
  const types = new Set<string>();
  let jsonLd: string | null = null;
  let imageCount = 0;
  let imagesMissingAlt = 0;
  const links = new Map<string, ParsedLink>();
  let anchor: { href: string; nofollow: boolean; text: string } | null = null;
  let skipDepth = 0;
  const textParts: string[] = [];

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const tag = name.toLowerCase();
        if (SKIP_TEXT.has(tag)) skipDepth += 1;
        if (BLOCK.has(tag)) textParts.push(" ");

        switch (tag) {
          case "html":
            if (attrs["lang"]) lang = attrs["lang"].trim() || null;
            break;
          case "base":
            if (attrs["href"]) base = normalizeUrl(attrs["href"], pageUrl) ?? base;
            break;
          case "title":
            if (title === null && titleBuffer === null) titleBuffer = "";
            break;
          case "meta": {
            const metaName = (attrs["name"] ?? "").toLowerCase();
            const content = attrs["content"] ?? "";
            if (metaName === "description" && description === null) description = content;
            if (metaName === "robots" || metaName === "googlebot") robots.push(content);
            break;
          }
          case "link": {
            const rel = (attrs["rel"] ?? "").toLowerCase().split(/\s+/);
            const href = attrs["href"];
            if (!href) break;
            if (rel.includes("canonical") && canonical === null) canonical = normalizeUrl(href, base);
            if (rel.includes("alternate") && attrs["hreflang"]) {
              const target = normalizeUrl(href, base);
              if (target) hreflang.push({ lang: attrs["hreflang"].trim().toLowerCase(), href: target });
            }
            break;
          }
          case "h1":
            h1Count += 1;
            if (h1 === null && h1Buffer === null) h1Buffer = "";
            break;
          case "h2":
            h2Count += 1;
            break;
          case "img":
            imageCount += 1;
            if (!("alt" in attrs)) imagesMissingAlt += 1;
            break;
          case "a": {
            const href = attrs["href"];
            const target = href ? normalizeUrl(href, base) : null;
            const rel = (attrs["rel"] ?? "").toLowerCase();
            anchor = target ? { href: target, nofollow: /\bnofollow\b/.test(rel), text: "" } : null;
            break;
          }
          case "script":
            if ((attrs["type"] ?? "").toLowerCase() === "application/ld+json") jsonLd = "";
            break;
        }
        if (attrs["itemtype"]) {
          for (const itemType of attrs["itemtype"].split(/\s+/)) {
            const last = itemType.replace(/\/+$/, "").split("/").pop();
            if (last) types.add(last);
          }
        }
      },
      ontext(text) {
        if (titleBuffer !== null) titleBuffer += text;
        if (jsonLd !== null) jsonLd += text;
        if (skipDepth > 0) return;
        if (h1Buffer !== null) h1Buffer += text;
        if (anchor) anchor.text += text;
        textParts.push(text);
      },
      onclosetag(name) {
        const tag = name.toLowerCase();
        if (SKIP_TEXT.has(tag)) skipDepth = Math.max(0, skipDepth - 1);
        if (BLOCK.has(tag)) textParts.push(" ");
        if (tag === "title" && titleBuffer !== null) {
          title = titleBuffer;
          titleBuffer = null;
        }
        if (tag === "h1" && h1Buffer !== null) {
          h1 = h1Buffer;
          h1Buffer = null;
        }
        if (tag === "script" && jsonLd !== null) {
          try {
            collectTypes(JSON.parse(jsonLd), types);
          } catch {
            // Invalid JSON-LD is not structured data; nothing to record.
          }
          jsonLd = null;
        }
        if (tag === "a" && anchor) {
          if (!links.has(anchor.href) && links.size < MAX_LINKS) {
            links.set(anchor.href, { url: anchor.href, anchor: clean(anchor.text).slice(0, 200), nofollow: anchor.nofollow });
          }
          anchor = null;
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();

  const text = clean(textParts.join(""));
  const words = text ? text.split(" ").filter((word) => /[\p{L}\p{N}]/u.test(word)) : [];

  return {
    title: cap(title, 500),
    description: cap(description, 1_000),
    metaRobots: robots.length ? cap(robots.join(", "), 200) : null,
    canonical,
    lang,
    hreflang: hreflang.slice(0, 100),
    h1: cap(h1, 500),
    h1Count,
    h2Count,
    wordCount: words.length,
    contentHash: text ? createHash("sha256").update(text.toLowerCase()).digest("hex") : null,
    schemaTypes: [...types].slice(0, 50),
    imageCount,
    imagesMissingAlt,
    links: [...links.values()],
  };
}

/** `noindex` / `none` in a meta robots value or an X-Robots-Tag header. */
export function hasNoindex(...values: (string | null | undefined)[]): boolean {
  return values.some((value) => !!value && /\b(noindex|none)\b/i.test(value));
}
