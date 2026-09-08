import { z } from "zod";
import { ICON_NAMES } from "@/lib/content/icons";
import { gridConfig } from "@/lib/content/grid";
import { alignToken, backgroundMediaId, styleField } from "@/lib/content/presentation";

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

/**
 * A media reference.
 *
 * Optional everywhere, deliberately: a block is added before it is filled in,
 * so requiring an image would make "add an image block" impossible — you would
 * have to choose the image before the block existed. Renderers skip a missing
 * image rather than showing a broken frame, and `blockWarnings` reports the gap
 * so it is visible in the builder instead of silently shipping an empty band.
 */
export const mediaRef = z
  .string()
  .cuid()
  .optional()
  .or(z.literal("").transform(() => undefined));

/** How a card presents its image. Shared by every card-bearing block. */
export const aspectRatio = z.enum(["auto", "1:1", "4:3", "3:2", "16:9", "21:9"]);
export const objectFit = z.enum(["cover", "contain"]);
export const imagePosition = z.enum(["center", "top", "bottom", "left", "right"]);
export const cardRadius = z.enum(["none", "sm", "md", "lg", "full"]);
export const cardStyle = z.enum(["flat", "border", "shadow", "elevated", "glass"]);
export const cardOverlay = z.enum(["none", "dark", "light"]);

export const imageTreatment = z.object({
  aspect: aspectRatio.default("4:3"),
  fit: objectFit.default("cover"),
  position: imagePosition.default("center"),
  radius: cardRadius.default("md"),
  overlay: cardOverlay.default("none"),
});

/** Splits available to a two-column section, text column first. */
export const splitRatio = z.enum(["50/50", "40/60", "60/40", "35/65", "65/35"]);

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
  band: styleField,
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
  band: styleField,
});

export const imageBlock = z.object({
  mediaId: mediaRef,
  /** Overrides the media library's own alt text for this placement. */
  alt: optionalText(300),
  caption: optionalText(300),
  width: imageWidth.default("container"),
  band: styleField,
});

export const imageBoxBlock = z.object({
  mediaId: mediaRef,
  alt: optionalText(300),
  title: trimmed(160).min(2, "Enter a title."),
  text: optionalText(600),
  ctaLabel: optionalText(60),
  ctaHref: linkHref.optional(),
  band: styleField,
});

export const imageTextBlock = z.object({
  mediaId: mediaRef,
  alt: optionalText(300),
  eyebrow: optionalText(80),
  heading: trimmed(200).min(2, "Enter a heading."),
  body: optionalText(3000),
  ctaLabel: optionalText(60),
  ctaHref: linkHref.optional(),
  imagePosition: z.enum(["left", "right"]).default("left"),
  band: styleField,
});

export const tableBlock = z.object({
  heading: optionalText(200),
  /** Rendered as <caption>: a data table needs one to be navigable. */
  caption: optionalText(300),
  headers: z.array(trimmed(120)).min(1, "A table needs at least one column.").max(8),
  rows: z.array(z.array(trimmed(500)).max(8)).min(1, "A table needs at least one row.").max(60),
  band: styleField,
});

export const featureBlock = z.object({
  eyebrow: optionalText(80),
  heading: trimmed(200).min(2, "Enter a heading."),
  body: optionalText(2000),
  bullets: z.array(trimmed(300)).max(8).default([]),
  mediaId: mediaRef,
  alt: optionalText(300),
  ctaLabel: optionalText(60),
  ctaHref: linkHref.optional(),
  band: styleField,
});

export const iconName = z.enum(ICON_NAMES);

export const listBlock = z.object({
  heading: optionalText(200),
  style: z.enum(["bulleted", "numbered"]).default("bulleted"),
  items: z.array(trimmed(300)).min(1, "Add at least one item.").max(20),
  band: styleField,
});

export const textListBlock = z.object({
  heading: optionalText(200),
  items: z
    .array(
      z.object({
        title: trimmed(160).min(1, "Each item needs a title."),
        text: optionalText(600),
      }),
    )
    .min(1, "Add at least one item.")
    .max(20),
  band: styleField,
});

export const iconBlock = z.object({
  icon: iconName.default("sparkles"),
  heading: trimmed(200).min(2, "Enter a heading."),
  body: optionalText(1200),
  align: alignment.default("left"),
  band: styleField,
});

/**
 * Icon cards.
 *
 * A superset of the shape this block shipped with: `columns` is still accepted
 * and still seeds the grid, so every row stored before the grid controls
 * existed parses and renders as it did. New saves write `grid`, which
 * `resolveGrid` prefers.
 */
export const iconCardsBlock = z.object({
  eyebrow: optionalText(80),
  heading: optionalText(200),
  body: optionalText(1200),
  /** Legacy desktop column count. Superseded by `grid`, kept for old rows. */
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
  grid: gridConfig.optional(),
  cardStyle: cardStyle.default("border"),
  /** How the icon itself is drawn. */
  iconStyle: z.enum(["plain", "tile", "circle"]).default("tile"),
  iconSize: z.enum(["sm", "md", "lg"]).default("md"),
  iconColor: z.enum(["red", "navy", "muted"]).default("red"),
  items: z
    .array(
      z.object({
        icon: iconName.default("sparkles"),
        /** An image from the media library, used instead of the icon when set. */
        mediaId: mediaRef,
        alt: optionalText(300),
        eyebrow: optionalText(80),
        title: trimmed(160).min(1, "Each card needs a title."),
        text: optionalText(500),
        badge: optionalText(40),
        href: linkHref.optional(),
        buttonLabel: optionalText(60),
        buttonHref: linkHref.optional(),
        /** Hidden cards keep their content and their position. */
        enabled: z.boolean().default(true),
      }),
    )
    .min(1, "Add at least one card.")
    .max(24),
  band: styleField,
});

/** Image cards. A superset of the original shape, on the same terms as above. */
export const imageCardsBlock = z.object({
  eyebrow: optionalText(80),
  heading: optionalText(200),
  body: optionalText(1200),
  /** Legacy desktop column count. Superseded by `grid`, kept for old rows. */
  columns: z.union([z.literal(2), z.literal(3)]).optional(),
  grid: gridConfig.optional(),
  image: imageTreatment.optional(),
  cardStyle: cardStyle.default("border"),
  items: z
    .array(
      z.object({
        mediaId: mediaRef,
        /** Swapped in on hover. Decorative by definition, so it carries no alt. */
        hoverMediaId: mediaRef,
        alt: optionalText(300),
        eyebrow: optionalText(80),
        title: trimmed(160).min(1, "Each card needs a title."),
        text: optionalText(500),
        badge: optionalText(40),
        icon: iconName.optional(),
        href: linkHref.optional(),
        buttonLabel: optionalText(60),
        buttonHref: linkHref.optional(),
        enabled: z.boolean().default(true),
      }),
    )
    .min(1, "Add at least one card.")
    .max(24),
  band: styleField,
});

/**
 * Call to action.
 *
 * This type predates the builder — the homepage and two other pages already
 * have `cta` sections — so the schema is a superset of the original
 * `{ heading, body?, ctaLabel, ctaHref }`: every existing row still parses, and
 * the new fields are optional with defaults that reproduce how those rows
 * already render. Promoting the type rather than adding a second one keeps a
 * single CTA in the product (CLAUDE.md 2 rule 10).
 */
export const ctaBlock = z.object({
  heading: trimmed(200).min(2, "Enter a heading."),
  body: optionalText(800),
  ctaLabel: trimmed(60).min(1, "Enter the button label."),
  ctaHref: linkHref,
  secondaryLabel: optionalText(60),
  secondaryHref: linkHref.optional(),
  tone: z.enum(["navy", "light"]).default("navy"),
  band: styleField,
});

export const faqBlock = z.object({
  heading: optionalText(200),
  items: z
    .array(
      z.object({
        question: trimmed(300).min(3, "Enter the question."),
        answer: trimmed(3000).min(3, "Enter the answer."),
      }),
    )
    .min(1, "Add at least one question.")
    .max(30),
  band: styleField,
});


// ---------------------------------------------------------------------------
// Layout blocks
// ---------------------------------------------------------------------------

/**
 * Text beside an image.
 *
 * The workhorse two-column band: which side the image sits on, how the width is
 * split, and an optional checklist under the copy. `imageText` already existed
 * and stays; this is the version with the full layout controls, and the two are
 * offered as one entry in Add Section — the older type is still rendered for
 * the rows that hold it.
 */
export const textImageBlock = z.object({
  eyebrow: optionalText(80),
  heading: trimmed(200).min(2, "Enter a heading."),
  /** Markdown-lite, the same dialect as the rich text block. */
  body: optionalText(4000),
  bullets: z.array(trimmed(300)).max(10).default([]),
  ctaLabel: optionalText(60),
  ctaHref: linkHref.optional(),
  secondaryLabel: optionalText(60),
  secondaryHref: linkHref.optional(),

  mediaId: mediaRef,
  alt: optionalText(300),
  /** A decorative image is hidden from assistive technology (CLAUDE.md 12). */
  decorative: z.boolean().default(false),
  image: imageTreatment.optional(),
  imageShadow: z.boolean().default(false),
  imageSide: z.enum(["left", "right"]).default("right"),
  split: splitRatio.default("50/50"),
  /** Where the two columns line up against each other on desktop. */
  verticalAlign: z.enum(["top", "center", "bottom"]).default("center"),
  band: styleField,
});

/**
 * Benefits / checklist.
 *
 * A heading and a repeating list of points, each with its own icon, laid out on
 * a configurable grid with an optional image beside it. This is the block that
 * reproduces the reference design, but nothing about it is specific to that
 * design — the copy, the icons, the columns, the image and the side it sits on
 * are all editor-controlled.
 */
export const benefitsBlock = z.object({
  eyebrow: optionalText(80),
  heading: optionalText(200),
  body: optionalText(3000),
  items: z
    .array(
      z.object({
        icon: iconName.default("check"),
        mediaId: mediaRef,
        alt: optionalText(300),
        title: trimmed(200).min(1, "Each benefit needs a title."),
        text: optionalText(600),
        href: linkHref.optional(),
        enabled: z.boolean().default(true),
      }),
    )
    .min(1, "Add at least one benefit.")
    .max(24),
  grid: gridConfig.optional(),
  /** How each point's marker is drawn. */
  iconStyle: z.enum(["check", "circle", "tile", "image", "none"]).default("check"),
  iconColor: z.enum(["red", "navy", "muted"]).default("red"),

  /** The optional image beside the list. */
  mediaId: mediaRef,
  alt: optionalText(300),
  decorative: z.boolean().default(false),
  image: imageTreatment.optional(),
  imageSide: z.enum(["left", "right"]).default("right"),
  split: splitRatio.default("50/50"),
  ctaLabel: optionalText(60),
  ctaHref: linkHref.optional(),
  band: styleField,
});

/** A grid of logos or marks. Images only, deliberately: no titles, no copy. */
export const logoGridBlock = z.object({
  eyebrow: optionalText(80),
  heading: optionalText(200),
  body: optionalText(1200),
  grid: gridConfig.optional(),
  /** Logos read better in one visual weight than in full colour on a grid. */
  treatment: z.enum(["full-colour", "muted", "monochrome"]).default("muted"),
  items: z
    .array(
      z.object({
        mediaId: mediaRef,
        alt: optionalText(300),
        /** The organisation's name, used as the alt when none is given. */
        name: optionalText(160),
        href: linkHref.optional(),
        enabled: z.boolean().default(true),
      }),
    )
    .min(1, "Add at least one logo.")
    .max(36),
  band: styleField,
});

/** One image, edge to edge, with optional copy laid over it. */
export const fullWidthImageBlock = z.object({
  mediaId: mediaRef,
  alt: optionalText(300),
  decorative: z.boolean().default(false),
  height: z.enum(["auto", "sm", "md", "lg", "screen"]).default("md"),
  fit: objectFit.default("cover"),
  position: imagePosition.default("center"),
  /** Copy over an image needs an overlay to stay readable; hence the default. */
  overlay: cardOverlay.default("dark"),
  eyebrow: optionalText(80),
  heading: optionalText(200),
  body: optionalText(1200),
  ctaLabel: optionalText(60),
  ctaHref: linkHref.optional(),
  align: alignToken.default("center"),
  band: styleField,
});

/**
 * Hero.
 *
 * This type predates the builder — the homepage, About and several other pages
 * already have `hero` sections — so the schema is a superset of the original
 * `{ eyebrow?, heading, body?, ctaLabel?, ctaHref?, secondaryLabel?,
 * secondaryHref?, facts? }`. Every existing row still parses, and the new
 * fields default to the layout those rows already produce. Promoting the type
 * rather than adding a second one keeps a single hero in the product
 * (CLAUDE.md 2 rule 10), and is how `cta` was handled before it.
 *
 * Nothing here is required beyond the heading. A hero with no image, no
 * background and no buttons is a valid hero.
 */
export const heroBlock = z.object({
  eyebrow: optionalText(80),
  heading: trimmed(200).min(1, "Enter the heading."),
  body: optionalText(3000),
  ctaLabel: optionalText(60),
  ctaHref: linkHref.optional(),
  secondaryLabel: optionalText(60),
  secondaryHref: linkHref.optional(),
  facts: z
    .array(z.object({ label: trimmed(80), value: trimmed(80) }))
    .max(6)
    .optional(),

  layout: z.enum(["stacked", "text-image", "image-text", "centered", "split"]).default("stacked"),
  mediaId: mediaRef,
  alt: optionalText(300),
  decorative: z.boolean().default(false),
  imageSize: z.enum(["auto", "sm", "md", "lg"]).default("auto"),
  imageRadius: cardRadius.default("lg"),
  height: z.enum(["auto", "sm", "md", "lg", "screen"]).default("auto"),
  band: styleField,
});

export const BLOCK_SCHEMAS = {
  hero: heroBlock,
  heading: headingBlock,
  richText: richTextBlock,
  image: imageBlock,
  imageBox: imageBoxBlock,
  imageText: imageTextBlock,
  table: tableBlock,
  feature: featureBlock,
  list: listBlock,
  textList: textListBlock,
  icon: iconBlock,
  iconCards: iconCardsBlock,
  imageCards: imageCardsBlock,
  cta: ctaBlock,
  faq: faqBlock,
  textImage: textImageBlock,
  benefits: benefitsBlock,
  logoGrid: logoGridBlock,
  fullWidthImage: fullWidthImageBlock,
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
  group: "Layout" | "Text" | "Media" | "Data";
  defaults: Record<string, unknown>;
  /**
   * Named starting points for the same block.
   *
   * A preset only seeds defaults — every setting it touches stays editable
   * afterwards. It exists so "four columns of image cards" is one click rather
   * than a click and then a trip through the Grid tab.
   */
  presets?: readonly { label: string; defaults: Record<string, unknown> }[];
};

const CARD_GRID_PRESETS = [
  { label: "2 columns", defaults: { grid: { desktop: 2, tablet: 2, mobile: 1, gap: "md" } } },
  { label: "3 columns", defaults: { grid: { desktop: 3, tablet: 2, mobile: 1, gap: "md" } } },
  { label: "4 columns", defaults: { grid: { desktop: 4, tablet: 2, mobile: 1, gap: "md" } } },
  { label: "6 columns", defaults: { grid: { desktop: 6, tablet: 3, mobile: 2, gap: "sm" } } },
] as const;

export const BLOCK_LIBRARY: readonly BlockDefinition[] = [
  {
    type: "hero",
    label: "Hero",
    description: "The opening band: heading, copy, buttons, and an optional image or background.",
    group: "Layout",
    defaults: {
      heading: "A heading that says what this page is",
      body: "",
      layout: "stacked",
      imageSize: "auto",
      imageRadius: "lg",
      height: "auto",
    },
    presets: [
      { label: "Text only", defaults: { layout: "stacked" } },
      { label: "Text left, image right", defaults: { layout: "text-image" } },
      { label: "Image left, text right", defaults: { layout: "image-text" } },
      { label: "Centred", defaults: { layout: "centered" } },
    ],
  },
  {
    type: "textImage",
    label: "Text and image",
    description: "Two columns: copy, a checklist and buttons beside an image. The split is yours.",
    group: "Layout",
    defaults: {
      heading: "Heading beside the image",
      body: "Write the copy for this section here.",
      bullets: [],
      imageSide: "right",
      split: "50/50",
      verticalAlign: "center",
    },
    presets: [
      { label: "Text left, image right", defaults: { imageSide: "right", split: "50/50" } },
      { label: "Image left, text right", defaults: { imageSide: "left", split: "50/50" } },
      { label: "Wide image", defaults: { imageSide: "right", split: "40/60" } },
    ],
  },
  {
    type: "benefits",
    label: "Benefits",
    description: "A heading, a checklist of points on a grid you control, and an optional image.",
    group: "Layout",
    defaults: {
      heading: "What you get",
      body: "",
      iconStyle: "check",
      iconColor: "red",
      imageSide: "right",
      split: "50/50",
      grid: { desktop: 1, tablet: 1, mobile: 1, gap: "md" },
      items: [
        { icon: "check", title: "First benefit", text: "" },
        { icon: "check", title: "Second benefit", text: "" },
        { icon: "check", title: "Third benefit", text: "" },
      ],
    },
    presets: [
      {
        label: "Checklist",
        defaults: { iconStyle: "check", grid: { desktop: 1, tablet: 1, mobile: 1, gap: "md" } },
      },
      {
        label: "Two columns",
        defaults: { iconStyle: "check", grid: { desktop: 2, tablet: 2, mobile: 1, gap: "md" } },
      },
      {
        label: "Icon cards",
        defaults: { iconStyle: "tile", grid: { desktop: 3, tablet: 2, mobile: 1, gap: "lg" } },
      },
    ],
  },
  {
    type: "logoGrid",
    label: "Logo grid",
    description: "A grid of client or partner logos, in one visual weight.",
    group: "Media",
    defaults: {
      heading: "Who we work with",
      treatment: "muted",
      grid: { desktop: 6, tablet: 3, mobile: 2, gap: "lg" },
      items: [{ name: "" }, { name: "" }, { name: "" }, { name: "" }],
    },
    presets: CARD_GRID_PRESETS,
  },
  {
    type: "fullWidthImage",
    label: "Full width image",
    description: "One image edge to edge, with optional copy laid over it.",
    group: "Media",
    defaults: { height: "md", fit: "cover", position: "center", overlay: "none", align: "center" },
    presets: [
      { label: "Image only", defaults: { heading: "", body: "", overlay: "none" } },
      { label: "With copy over it", defaults: { heading: "A line over the image", overlay: "dark" } },
      { label: "Full height", defaults: { height: "screen", overlay: "dark" } },
    ],
  },
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
    type: "list",
    label: "List",
    description: "A bulleted or numbered list of short points.",
    group: "Text",
    defaults: { style: "bulleted", items: ["First point", "Second point"] },
  },
  {
    type: "textList",
    label: "Text list",
    description: "A list where each point has its own title and explanation.",
    group: "Text",
    defaults: {
      items: [
        { title: "First point", text: "" },
        { title: "Second point", text: "" },
      ],
    },
  },
  {
    type: "icon",
    label: "Icon",
    description: "A single icon above a heading and a short paragraph.",
    group: "Text",
    defaults: { icon: "sparkles", heading: "A point worth making", align: "left" },
  },
  {
    type: "cta",
    label: "Call to action",
    description: "A band with a heading and up to two buttons.",
    group: "Text",
    defaults: {
      heading: "Ready to talk?",
      ctaLabel: "Start a conversation",
      ctaHref: "/contact",
      tone: "navy",
    },
  },
  {
    type: "faq",
    label: "FAQ",
    description: "Questions and answers, expandable.",
    group: "Text",
    defaults: {
      items: [{ question: "What does this cost?", answer: "Write the answer here." }],
    },
  },
  {
    type: "iconCards",
    label: "Icon cards",
    description: "A grid of cards, each with an icon, a title and text.",
    group: "Media",
    defaults: {
      grid: { desktop: 3, tablet: 2, mobile: 1, gap: "md" },
      cardStyle: "border",
      iconStyle: "tile",
      iconSize: "md",
      iconColor: "red",
      items: [
        { icon: "search", title: "First card", text: "" },
        { icon: "target", title: "Second card", text: "" },
        { icon: "trending-up", title: "Third card", text: "" },
      ],
    },
    presets: CARD_GRID_PRESETS,
  },
  {
    type: "imageCards",
    label: "Image cards",
    description: "A grid of cards, each with an image, a title and text.",
    group: "Media",
    defaults: {
      grid: { desktop: 3, tablet: 2, mobile: 1, gap: "md" },
      cardStyle: "border",
      image: { aspect: "4:3", fit: "cover", position: "center", radius: "md", overlay: "none" },
      items: [
        { title: "First card", text: "" },
        { title: "Second card", text: "" },
        { title: "Third card", text: "" },
      ],
    },
    presets: CARD_GRID_PRESETS,
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

/**
 * Every mediaId a block references, for batch resolution at read time.
 *
 * Four places hold one: the block itself, a card in its `items`, a card's hover
 * image, and the section background. A miss here is not a type error — it is an
 * image that silently fails to render, because the resolver was never asked for
 * it — so this stays the single list of every place an id can live.
 */
export function mediaIdsIn(type: string, content: unknown): string[] {
  if (!isBlockType(type) || content === null || typeof content !== "object") return [];
  const value = content as Record<string, unknown>;
  const ids: string[] = [];

  const push = (candidate: unknown) => {
    if (typeof candidate === "string" && candidate.length > 0) ids.push(candidate);
  };

  push(value["mediaId"]);
  if (Array.isArray(value["items"])) {
    for (const item of value["items"]) {
      if (item && typeof item === "object") {
        const card = item as Record<string, unknown>;
        push(card["mediaId"]);
        push(card["hoverMediaId"]);
      }
    }
  }
  push(backgroundMediaId(content));

  return ids;
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
  if ((type === "imageCards" || type === "logoGrid") && Array.isArray(value["items"])) {
    const missing = value["items"].filter(
      (item) => !(item && typeof item === "object" && (item as Record<string, unknown>)["mediaId"]),
    ).length;
    if (missing > 0) warnings.push(`${missing} card${missing === 1 ? "" : "s"} without an image`);
  }
  if (type === "cta") {
    if (value["secondaryLabel"] && !value["secondaryHref"]) {
      warnings.push("Second button has no link");
    }
    if (value["secondaryHref"] && !value["secondaryLabel"]) {
      warnings.push("Second link has no button label");
    }
  }

  if (type === "fullWidthImage" && !value["mediaId"]) {
    warnings.push("No image chosen");
  }
  if (type === "benefits" || type === "textImage") {
    const items = Array.isArray(value["items"]) ? value["items"] : [];
    const hidden = items.filter(
      (item) => item && typeof item === "object" && (item as Record<string, unknown>)["enabled"] === false,
    ).length;
    if (hidden > 0) warnings.push(`${hidden} hidden`);
  }
  if (value["decorative"] === true && value["alt"]) {
    // A decorative image is announced as nothing; alt text on one is a
    // contradiction the editor should see rather than a silent discard.
    warnings.push("Marked decorative, but has alt text");
  }

  const label = value["ctaLabel"];
  const href = value["ctaHref"];
  if (label && !href) warnings.push("Button has no link");
  if (href && !label) warnings.push("Link has no button label");

  return warnings;
}
