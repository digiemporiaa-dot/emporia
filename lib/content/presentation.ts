import { z } from "zod";

/**
 * Section presentation: container, spacing, alignment, background, border.
 *
 * One shared object, attached to every block as an optional `band` key. Two
 * consequences, both deliberate:
 *
 * **Optional.** Every section row stored before this existed has no `band`,
 * parses unchanged, and renders exactly as it did — the defaults each block
 * passes to `<Band>` reproduce its previous padding and width precisely
 * (CLAUDE.md 2 rule 10).
 *
 * **Tokens, not values.** Spacing, width and radius are enumerated tokens that
 * map to *literal* Tailwind classes below. A class is never interpolated:
 * `py-${n}` is invisible to Tailwind's scanner, so the CSS would not exist and
 * the spacing would silently vanish in production while looking right in dev.
 *
 * The two things that cannot be tokens are colours and the background image
 * URL. Those become inline styles, so they are validated hard: a colour must be
 * a six-digit hex, and a URL must be one of ours and free of the characters
 * that could break out of `url(...)`.
 */

/**
 * The spacing scale.
 *
 * Not invented: these are the `py-*` pairs the section renderers already used,
 * turned into tokens. `xl` and `2xl` differ only at the large breakpoint
 * because the existing design uses both — keeping both is what lets every
 * published page keep the exact spacing it has today.
 */
export const spaceToken = z.enum(["none", "xs", "sm", "md", "lg", "xl", "2xl", "3xl"]);
export type SpaceToken = z.infer<typeof spaceToken>;

export const containerToken = z.enum(["narrow", "medium", "default", "wide", "full"]);
export type ContainerToken = z.infer<typeof containerToken>;

export const alignToken = z.enum(["left", "center", "right"]);
export type AlignToken = z.infer<typeof alignToken>;

export const verticalAlignToken = z.enum(["top", "center", "bottom"]);
export type VerticalAlignToken = z.infer<typeof verticalAlignToken>;

export const radiusToken = z.enum(["none", "sm", "md", "lg", "xl", "full"]);
export type RadiusToken = z.infer<typeof radiusToken>;

export const borderToken = z.enum(["none", "subtle", "strong"]);

export const backgroundSize = z.enum(["cover", "contain"]);
export const backgroundPosition = z.enum([
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);
export type BackgroundPosition = z.infer<typeof backgroundPosition>;

/**
 * A six-digit hex colour.
 *
 * Not a free-form CSS colour: `red; background-image: url(...)` is a string a
 * browser will happily accept from an inline style object in some engines, and
 * "any CSS value the editor types" is not a thing worth supporting for a brand
 * palette (CLAUDE.md 11).
 */
export const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour, e.g. #002A3A.");

const optionalHex = hexColor.optional().or(z.literal("").transform(() => undefined));

const optionalMediaId = z
  .string()
  .cuid()
  .optional()
  .or(z.literal("").transform(() => undefined));

export const backgroundConfig = z.object({
  kind: z.enum(["none", "solid", "gradient", "image"]).default("none"),
  color: optionalHex,
  /** Gradient runs from `color` to `colorTo` at `angle` degrees. */
  colorTo: optionalHex,
  angle: z.coerce.number().int().min(0).max(360).default(160),
  mediaId: optionalMediaId,
  size: backgroundSize.default("cover"),
  position: backgroundPosition.default("center"),
  overlay: z.boolean().default(false),
  overlayColor: optionalHex,
  /** Percent. Stored as an integer so the control is a slider, not a float. */
  overlayOpacity: z.coerce.number().int().min(0).max(100).default(40),
});

export type BackgroundConfig = z.infer<typeof backgroundConfig>;

/**
 * A fragment identifier.
 *
 * Restricted to what belongs in a URL fragment, which also means it cannot
 * carry a quote or an angle bracket into the `id` attribute. Free-form CSS
 * class names are deliberately not offered: "add a class" is an escape hatch
 * into the design system, and the Style tab is the supported way to change how
 * a section looks (CLAUDE.md 6).
 */
export const anchorId = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9-]{1,60}$/, "Lowercase letters, digits and hyphens, starting with a letter.")
  .optional()
  .or(z.literal("").transform(() => undefined));

/** What an editor may change for one breakpoint. */
export const breakpointOverride = z.object({
  paddingTop: spaceToken.optional(),
  paddingBottom: spaceToken.optional(),
  align: alignToken.optional(),
});
export type BreakpointOverride = z.infer<typeof breakpointOverride>;

export const presentation = z.object({
  container: containerToken.optional(),
  paddingTop: spaceToken.optional(),
  paddingBottom: spaceToken.optional(),
  marginTop: spaceToken.optional(),
  marginBottom: spaceToken.optional(),
  align: alignToken.optional(),
  verticalAlign: verticalAlignToken.optional(),
  background: backgroundConfig.optional(),
  border: borderToken.default("none"),
  radius: radiusToken.default("none"),
  /**
   * Which way the text reads. `auto` keeps the site's dark-on-light default;
   * `light` is what a dark background image needs, and an editor choosing a
   * dark background without it would end up with unreadable text
   * (CLAUDE.md 12, AA contrast).
   */
  textTone: z.enum(["auto", "dark", "light"]).default("auto"),

  /** Advanced. A link target for this section, used as `#anchor`. */
  anchorId,
  /**
   * Device visibility.
   *
   * CSS, not JavaScript: the section is in the markup and hidden by a media
   * query, so there is no layout shift and no hydration mismatch. It is
   * genuinely hidden — `display: none` removes it from the accessibility tree
   * too, so a screen reader on a phone does not read a section a sighted
   * visitor cannot see.
   */
  hideDesktop: z.boolean().default(false),
  hideTablet: z.boolean().default(false),
  hideMobile: z.boolean().default(false),

  /**
   * Per-breakpoint overrides.
   *
   * The base fields above are not "desktop only" — `paddingTop: "md"` already
   * emits `pt-10 lg:pt-14`, a small-screen value and a desktop one. These
   * override that pair rather than replacing the model:
   *
   *   mobile   replaces the small-screen half; the desktop half still applies
   *   tablet   inserts an `sm:` value that holds between tablet and desktop
   *
   * Absent means "inherit", which is why a section saved before these existed
   * produces exactly the classes it always did. Both are deliberately narrow —
   * padding and alignment are what actually differ between a phone and a
   * desktop; anything more would be a second layout system.
   */
  tablet: breakpointOverride.optional(),
  mobile: breakpointOverride.optional(),
});

export type Presentation = z.infer<typeof presentation>;

/** Attach to a block schema. Optional so existing rows are untouched. */
export const styleField = presentation.optional();

// ---------------------------------------------------------------------------
// Token → class maps. Every value is a literal Tailwind class.
// ---------------------------------------------------------------------------

/**
 * Padding, one breakpoint per map.
 *
 * These used to be two maps holding a pair of classes each — `"pt-10 lg:pt-14"`
 * — which is the same thing as BASE plus LG below, and is exactly what a
 * section with no overrides still emits. Splitting them is what lets a mobile
 * override replace only the small-screen half, and a tablet override slot an
 * `sm:` value in between, without either touching the other.
 *
 * Every class is written out literally. An interpolated one is invisible to
 * Tailwind's scanner, so the CSS is never generated and the padding silently
 * disappears in production while looking correct in development.
 */
const PADDING_TOP_BASE: Record<SpaceToken, string> = {
  none: "",
  xs: "pt-4",
  sm: "pt-8",
  md: "pt-10",
  lg: "pt-12",
  xl: "pt-14",
  "2xl": "pt-14",
  "3xl": "pt-20",
};

const PADDING_TOP_SM: Record<SpaceToken, string> = {
  none: "sm:pt-0",
  xs: "sm:pt-4",
  sm: "sm:pt-8",
  md: "sm:pt-10",
  lg: "sm:pt-12",
  xl: "sm:pt-14",
  "2xl": "sm:pt-14",
  "3xl": "sm:pt-20",
};

const PADDING_TOP_LG: Record<SpaceToken, string> = {
  none: "",
  xs: "lg:pt-6",
  sm: "lg:pt-10",
  md: "lg:pt-14",
  lg: "lg:pt-16",
  xl: "lg:pt-18",
  "2xl": "lg:pt-20",
  "3xl": "lg:pt-28",
};

const PADDING_BOTTOM_BASE: Record<SpaceToken, string> = {
  none: "",
  xs: "pb-4",
  sm: "pb-8",
  md: "pb-10",
  lg: "pb-12",
  xl: "pb-14",
  "2xl": "pb-14",
  "3xl": "pb-20",
};

const PADDING_BOTTOM_SM: Record<SpaceToken, string> = {
  none: "sm:pb-0",
  xs: "sm:pb-4",
  sm: "sm:pb-8",
  md: "sm:pb-10",
  lg: "sm:pb-12",
  xl: "sm:pb-14",
  "2xl": "sm:pb-14",
  "3xl": "sm:pb-20",
};

const PADDING_BOTTOM_LG: Record<SpaceToken, string> = {
  none: "",
  xs: "lg:pb-6",
  sm: "lg:pb-10",
  md: "lg:pb-14",
  lg: "lg:pb-16",
  xl: "lg:pb-18",
  "2xl": "lg:pb-20",
  "3xl": "lg:pb-28",
};

const MARGIN_TOP: Record<SpaceToken, string> = {
  none: "",
  xs: "mt-3",
  sm: "mt-6",
  md: "mt-10",
  lg: "mt-14",
  xl: "mt-20",
  "2xl": "mt-24",
  "3xl": "mt-28",
};

const MARGIN_BOTTOM: Record<SpaceToken, string> = {
  none: "",
  xs: "mb-3",
  sm: "mb-6",
  md: "mb-10",
  lg: "mb-14",
  xl: "mb-20",
  "2xl": "mb-24",
  "3xl": "mb-28",
};

const ALIGN: Record<AlignToken, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const ALIGN_SM: Record<AlignToken, string> = {
  left: "sm:text-left",
  center: "sm:text-center",
  right: "sm:text-right",
};

const ALIGN_LG: Record<AlignToken, string> = {
  left: "lg:text-left",
  center: "lg:text-center",
  right: "lg:text-right",
};

const VERTICAL_ALIGN: Record<VerticalAlignToken, string> = {
  top: "items-start",
  center: "items-center",
  bottom: "items-end",
};

const RADIUS: Record<RadiusToken, string> = {
  none: "",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-3xl",
};

const BORDER: Record<z.infer<typeof borderToken>, string> = {
  none: "",
  subtle: "border border-line",
  strong: "border border-line-strong",
};

/** `Container`'s own widths, plus `full` which opts out of the container. */
const CONTAINER_WIDTH: Record<ContainerToken, "narrow" | "page" | "wide" | null> = {
  narrow: "narrow",
  medium: "narrow",
  default: "page",
  wide: "wide",
  full: null,
};

export const SPACE_LABELS: Record<SpaceToken, string> = {
  none: "None",
  xs: "Extra small",
  sm: "Small",
  md: "Medium",
  lg: "Large",
  xl: "Extra large",
  "2xl": "Huge",
  "3xl": "Maximum",
};

export const CONTAINER_LABELS: Record<ContainerToken, string> = {
  narrow: "Narrow",
  medium: "Medium",
  default: "Default",
  wide: "Wide",
  full: "Full width",
};

export const POSITION_LABELS: Record<BackgroundPosition, string> = {
  center: "Center",
  top: "Top",
  bottom: "Bottom",
  left: "Left",
  right: "Right",
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
};

const CSS_POSITION: Record<BackgroundPosition, string> = {
  center: "center",
  top: "top center",
  bottom: "bottom center",
  left: "center left",
  right: "center right",
  "top-left": "top left",
  "top-right": "top right",
  "bottom-left": "bottom left",
  "bottom-right": "bottom right",
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** What a block asks for when the editor has set nothing. */
export type BandDefaults = {
  paddingTop: SpaceToken;
  paddingBottom: SpaceToken;
  container: ContainerToken;
  /**
   * Literal classes for a band whose historical padding is not on the token
   * scale — the homepage hero's `pt-14 lg:pt-24` among them.
   *
   * Used only while the editor has set no padding of their own, and never
   * offered as a choice: growing the picker with one-off values to preserve one
   * band would make the scale meaningless. The moment someone picks a token,
   * the token wins.
   */
  paddingClassName?: string;
};

export type ResolvedBand = {
  /** Applied to the outer element. */
  outerClassName: string;
  /** `id` for the outer element, when the editor set an anchor. */
  anchorId: string | undefined;
  /** Applied to the inner container, or null when the section is full width. */
  containerWidth: "narrow" | "page" | "wide" | null;
  contentClassName: string;
  /** Inline styles for colours and the background image only. */
  outerStyle: Record<string, string>;
  overlayStyle: Record<string, string> | null;
  /** True when the band paints a dark surface and text must invert. */
  inverted: boolean;
};

/**
 * A URL safe to put inside `url(...)`.
 *
 * The value comes from our own Media table, so this is belt and braces rather
 * than the only defence — but an inline style is the one place where a stray
 * quote or parenthesis stops being data and starts being CSS.
 */
function safeCssUrl(url: string | undefined): string | null {
  if (!url) return null;
  // Absolute https for the usual case (R2), and a root-relative path for a
  // deployment serving media from its own origin. Nothing else: a scheme-less
  // or `javascript:` value has no business in a stylesheet.
  if (!/^https?:\/\//.test(url) && !/^\/[^/]/.test(url)) return null;
  if (/["'()\\\s]/.test(url)) return null;
  return url;
}

/** Percent (0–100) as a CSS alpha suffix on a hex colour. */
function hexWithOpacity(color: string, percent: number): string {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  const alpha = Math.round((clamped / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${color}${alpha}`;
}

export function resolveBand(
  style: Presentation | undefined,
  defaults: BandDefaults,
  backgroundUrl?: string | undefined,
): ResolvedBand {
  const container = style?.container ?? defaults.container;
  const background = style?.background;
  const outerStyle: Record<string, string> = {};
  let inverted = false;

  if (background?.kind === "solid" && background.color) {
    outerStyle["backgroundColor"] = background.color;
    inverted = isDark(background.color);
  }

  if (background?.kind === "gradient" && background.color) {
    const to = background.colorTo ?? background.color;
    outerStyle["backgroundImage"] =
      `linear-gradient(${background.angle}deg, ${background.color}, ${to})`;
    inverted = isDark(background.color) && isDark(to);
  }

  const url = background?.kind === "image" ? safeCssUrl(backgroundUrl) : null;
  if (url) {
    outerStyle["backgroundImage"] = `url(${url})`;
    outerStyle["backgroundSize"] = background!.size;
    outerStyle["backgroundPosition"] = CSS_POSITION[background!.position];
    outerStyle["backgroundRepeat"] = "no-repeat";
    // An image band without an overlay is a contrast gamble; with one, the
    // overlay decides. Either way the editor's tone choice wins below.
    inverted = Boolean(background!.overlay) && isDark(background!.overlayColor ?? "#002a3a");
  }

  if (style?.textTone === "light") inverted = true;
  if (style?.textTone === "dark") inverted = false;

  const overlayStyle =
    url && background?.overlay
      ? {
          backgroundColor: hexWithOpacity(
            background.overlayColor ?? "#002a3a",
            background.overlayOpacity,
          ),
        }
      : null;

  const outerClassName = [
    // Literal classes, as everywhere else here. `max-sm:` is below the tablet
    // breakpoint, `sm:max-lg:` is the tablet band, `lg:` is desktop up.
    style?.hideMobile ? "max-sm:hidden" : "",
    style?.hideTablet ? "sm:max-lg:hidden" : "",
    style?.hideDesktop ? "lg:hidden" : "",
    MARGIN_TOP[style?.marginTop ?? "none"],
    MARGIN_BOTTOM[style?.marginBottom ?? "none"],
    BORDER[style?.border ?? "none"],
    RADIUS[style?.radius ?? "none"],
    style?.radius && style.radius !== "none" ? "overflow-hidden" : "",
    Object.keys(outerStyle).length > 0 || overlayStyle ? "relative" : "",
    inverted ? "text-white [--band-ink:var(--color-white)]" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const untouched =
    !style?.paddingTop &&
    !style?.paddingBottom &&
    !style?.mobile?.paddingTop &&
    !style?.mobile?.paddingBottom &&
    !style?.tablet?.paddingTop &&
    !style?.tablet?.paddingBottom;

  const topToken = style?.paddingTop ?? defaults.paddingTop;
  const bottomToken = style?.paddingBottom ?? defaults.paddingBottom;

  const padding =
    untouched && defaults.paddingClassName
      ? [defaults.paddingClassName]
      : [
          // Small screens: the mobile override, or the base half of the token.
          PADDING_TOP_BASE[style?.mobile?.paddingTop ?? topToken],
          PADDING_BOTTOM_BASE[style?.mobile?.paddingBottom ?? bottomToken],
          // Tablet: only emitted when explicitly set, so a section that predates
          // these overrides keeps the exact two classes it has always had.
          style?.tablet?.paddingTop ? PADDING_TOP_SM[style.tablet.paddingTop] : "",
          style?.tablet?.paddingBottom ? PADDING_BOTTOM_SM[style.tablet.paddingBottom] : "",
          PADDING_TOP_LG[topToken],
          PADDING_BOTTOM_LG[bottomToken],
        ];

  const align = style?.align;
  const alignment = align
    ? [
        ALIGN[style?.mobile?.align ?? align],
        style?.tablet?.align ? ALIGN_SM[style.tablet.align] : "",
        // Only needed to undo a mobile or tablet override further up.
        style?.mobile?.align || style?.tablet?.align ? ALIGN_LG[align] : "",
      ]
    : [];

  const contentClassName = [
    ...padding,
    ...alignment,
    style?.verticalAlign ? VERTICAL_ALIGN[style.verticalAlign] : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    outerClassName,
    anchorId: style?.anchorId,
    containerWidth: CONTAINER_WIDTH[container],
    contentClassName,
    outerStyle,
    overlayStyle,
    inverted,
  };
}

/** Relative luminance, to decide whether text on this colour must be white. */
export function isDark(hex: string): boolean {
  const value = hex.replace("#", "");
  if (value.length !== 6) return false;
  const channel = (start: number) => {
    const raw = parseInt(value.slice(start, start + 2), 16) / 255;
    return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance < 0.4;
}

/** Background media referenced by a block's style, for batch resolution. */
export function backgroundMediaId(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const band = (content as Record<string, unknown>)["band"];
  if (!band || typeof band !== "object") return null;
  const background = (band as Record<string, unknown>)["background"];
  if (!background || typeof background !== "object") return null;
  const id = (background as Record<string, unknown>)["mediaId"];
  return typeof id === "string" && id.length > 0 ? id : null;
}
