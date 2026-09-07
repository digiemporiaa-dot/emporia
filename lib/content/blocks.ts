import { z } from "zod";

/**
 * Page builder blocks.
 *
 * These are the section types an editor can add from the builder. They live
 * apart from the bespoke section types in `sections.ts` — `hero`,
 * `positioning`, `legal` and the rest — which are hand-composed bands used by
 * the homepage, About, Careers and the legal pages. Those keep rendering
 * exactly as they did; they are simply not offered in the Add Section list,
 * because they are not general-purpose.
 *
 * Content is stored as JSON on PageSection, so it is parsed with zod before
 * render rather than trusted (CLAUDE.md 2 rule 4).
 *
 * Images are referenced by `mediaId` alone, never by a copied URL. Resolving
 * the row at read time means a replaced or re-described image is correct
 * everywhere it appears, instead of leaving stale snapshots behind in JSON.
 */

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .optional()
    .transform((value) => (value === "" ? undefined : value));

/** Internal links only. An editor pasting an external URL gets told, not redirected. */
export const linkHref = trimmed(300).refine(
  (value) => value.startsWith("/"),
  "Links must start with / — this field is for pages on this site.",
);

export const alignment = z.enum(["left", "center"]);
export const imageWidth = z.enum(["container", "wide", "full"]);

export const headingBlock = z.object({
  eyebrow: optionalText(80),
  text: trimmed(200).min(2, "Enter the heading."),
  /**
   * Level 2 or 3 only. The page's <h1> is its title, and letting a builder
   * emit a second one would break the document outline on every page it is
   * used (CLAUDE.md 12, accessibility).
   */
  level: z.union([z.literal(2), z.literal(3)]).default(2),
  align: alignment.default("left"),
});

export const richTextBlock = z.object({
  heading: optionalText(200),
  /**
   * Markdown-lite: blank-line separated paragraphs, with **bold**, *italic*
   * and [text](/path) inline. Stored as written and parsed to React elements
   * at render time — there is no HTML anywhere in this path, so there is
   * nothing to sanitise and no `dangerouslySetInnerHTML` to get wrong.
   */
  body: trimmed(8000).min(1, "Enter some text."),
});

export const imageBlock = z.object({
  /**
 * Optional, deliberately. A block is added before it is filled in, so requiring
 * an image here would make "add an image block" impossible — you would have to
 * choose the image before the block existed. Renderers skip a block with no
 * image rather than showing a broken frame, and `blockWarnings` reports the gap
 * so it is visible in the builder instead of silently shipping an empty band.
 */
  mediaId: z
    .string()
    .cuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /** Overrides the media library's own alt text for this placement. */
  alt: optionalText(300),
  caption: optionalText(300),
  width: imageWidth.default("container"),
});

export const imageBoxBlock = z.object({
  /**
 * Optional, deliberately. A block is added before it is filled in, so requiring
 * an image here would make "add an image block" impossible — you would have to
 * choose the image before the block existed. Renderers skip a block with no
 * image rather than showing a broken frame, and `blockWarnings` reports the gap
 * so it is visible in the builder instead of silently shipping an empty band.
 */
  mediaId: z
    .string()
    .cuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  alt: optionalText(300),
  title: trimmed(160).min(2, "Enter a title."),
  text: optionalText(600),
  ctaLabel: optionalText(60),
  ctaHref: linkHref.optional(),
});

export const imageTextBlock = z.object({
  /**
 * Optional, deliberately. A block is added before it is filled in, so requiring
 * an image here would make "add an image block" impossible — you would have to
 * choose the image before the block existed. Renderers skip a block with no
 * image rather than showing a broken frame, and `blockWarnings` reports the gap
 * so it is visible in the builder instead of silently shipping an empty band.
 */
  mediaId: z
    .string()
    .cuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  alt: optionalText(300),
  eyebrow: optionalText(80),
  heading: trimmed(200).min(2, "Enter a heading."),
  body: optionalText(3000),
  ctaLabel: optionalText(60),
  ctaHref: linkHref.optional(),
  imagePosition: z.enum(["left", "right"]).default("left"),
});

export const tableBlock = z.object({
  heading: optionalText(200),
  /** Rendered as <caption>: a data table needs one to be navigable. */
  caption: optionalText(300),
  headers: z.array(trimmed(120)).min(1, "A table needs at least one column.").max(8),
  rows: z.array(z.array(trimmed(500)).max(8)).min(1, "A table needs at least one row.").max(60),
});

export const featureBlock = z.object({
  eyebrow: optionalText(80),
  heading: trimmed(200).min(2, "Enter a heading."),
  body: optionalText(2000),
  bullets: z.array(trimmed(300)).max(8).default([]),
  mediaId: z
    .string()
    .cuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  alt: optionalText(300),
  ctaLabel: optionalText(60),
  ctaHref: linkHref.optional(),
});

export const BLOCK_SCHEMAS = {
  heading: headingBlock,
  richText: richTextBlock,
  image: imageBlock,
  imageBox: imageBoxBlock,
  imageText: imageTextBlock,
  table: tableBlock,
  feature: featureBlock,
} as const;

export type BlockType = keyof typeof BLOCK_SCHEMAS;
export type BlockContent<T extends BlockType> = z.infer<(typeof BLOCK_SCHEMAS)[T]>;

export function isBlockType(value: string): value is BlockType {
  return Object.prototype.hasOwnProperty.call(BLOCK_SCHEMAS, value);
}

/**
 * The Add Section list, and the defaults a freshly added block starts with.
 *
 * A new block is created already valid and already renderable, so adding one
 * shows something on the page immediately rather than an error state the
 * editor has to clear before they can see what they added.
 */
export type BlockDefinition = {
  type: BlockType;
  label: string;
  description: string;
  /** Grouping in the Add Section modal. */
  group: "Text" | "Media" | "Data";
  defaults: Record<string, unknown>;
};

export const BLOCK_LIBRARY: readonly BlockDefinition[] = [
  {
    type: "heading",
    label: "Heading",
    description: "A section heading, with an optional eyebrow above it.",
    group: "Text",
    defaults: { text: "Section heading", level: 2, align: "left" },
  },
  {
    type: "richText",
    label: "Rich text",
    description: "Paragraphs with bold, italic and links.",
    group: "Text",
    defaults: {
      heading: "",
      body: "Write the copy for this section here.\n\nUse **bold**, *italic* and [links](/contact).",
    },
  },
  {
    type: "feature",
    label: "Feature",
    description: "A headline point, with optional bullets, image and a call to action.",
    group: "Text",
    defaults: {
      heading: "What makes this different",
      body: "",
      bullets: [],
    },
  },
  {
    type: "image",
    label: "Image",
    description: "A single image, with an optional caption.",
    group: "Media",
    defaults: { width: "container" },
  },
  {
    type: "imageBox",
    label: "Image box",
    description: "An image with a title and text beneath it.",
    group: "Media",
    defaults: { title: "Image title" },
  },
  {
    type: "imageText",
    label: "Image and text",
    description: "An image beside a heading, copy and a call to action.",
    group: "Media",
    defaults: { heading: "Heading beside the image", imagePosition: "left" },
  },
  {
    type: "table",
    label: "Table",
    description: "A data table with a header row.",
    group: "Data",
    defaults: {
      headers: ["Column", "Column"],
      rows: [
        ["", ""],
        ["", ""],
      ],
    },
  },
];

export function blockDefinition(type: BlockType): BlockDefinition {
  const found = BLOCK_LIBRARY.find((block) => block.type === type);
  // The library and the schema map are declared together; a missing entry is a
  // programming error, not a data problem.
  if (!found) throw new Error(`No block definition for "${type}".`);
  return found;
}

/** Every mediaId referenced by a block, for batch resolution at read time. */
export function mediaIdsIn(type: string, content: unknown): string[] {
  if (!isBlockType(type) || content === null || typeof content !== "object") return [];
  const value = (content as Record<string, unknown>)["mediaId"];
  return typeof value === "string" && value.length > 0 ? [value] : [];
}

/** Blocks that are not worth rendering without an image. */
const NEEDS_IMAGE = new Set<BlockType>(["image", "imageBox", "imageText"]);

/**
 * What is still missing from a block.
 *
 * A block is allowed to be incomplete while it is being built — that is what a
 * draft is for — but the gap should be visible in the builder rather than
 * discovered as an empty band on the live page.
 */
export function blockWarnings(type: string, content: unknown): string[] {
  if (!isBlockType(type)) return [];
  const value = (content ?? {}) as Record<string, unknown>;
  const warnings: string[] = [];

  if (NEEDS_IMAGE.has(type) && !value["mediaId"]) {
    warnings.push("No image chosen");
  }
  if (type === "table") {
    const rows = Array.isArray(value["rows"]) ? (value["rows"] as unknown[][]) : [];
    const empty = rows.every((row) => row.every((cell) => String(cell ?? "").trim() === ""));
    if (rows.length > 0 && empty) warnings.push("Every cell is empty");
  }
  const label = value["ctaLabel"];
  const href = value["ctaHref"];
  if (label && !href) warnings.push("Button has no link");
  if (href && !label) warnings.push("Link has no button label");

  return warnings;
}
