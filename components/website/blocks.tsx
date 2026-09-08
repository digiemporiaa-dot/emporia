import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Container, CtaButton, Eyebrow } from "@/components/website/primitives";
import { HeroReveal, Reveal, Stagger, StaggerItem } from "@/components/website/motion";
import { parseInline, type Span } from "@/lib/content/inline";
import { Plus } from "lucide-react";
import { BlockIcon } from "@/components/website/icon";
import type { BlockContent } from "@/lib/content/blocks";
import { cn } from "@/lib/utils/cn";
import { Band } from "@/components/website/band";
import { gridClasses, resolveGrid } from "@/lib/content/grid";
import type { BlockImage, BlockImages } from "@/components/website/blocks-shared";

/**
 * Renderers for the page-builder blocks.
 *
 * Each block is a designed band rather than a generic div, so a page assembled
 * from blocks still has the rhythm of a hand-built one. Content arrives already
 * validated (lib/content/blocks), so these only concern themselves with layout.
 *
 * Images resolve from the `images` map the query batched, keyed by mediaId. A
 * block whose image is missing or deleted renders without it rather than
 * showing a broken frame.
 */

// Declared in blocks-shared so the band can name an image without importing
// this file, which imports the band.
export type { BlockImage, BlockImages } from "@/components/website/blocks-shared";

/**
 * The padding each block had before the Layout controls existed.
 *
 * A block passes its own default to `<Band>`, so a section with no `band` set
 * produces exactly the markup it always did. These are not arbitrary: they are
 * the `py-*` pairs the renderers previously hard-coded, expressed as tokens
 * (lib/content/presentation.ts).
 */
const PAD_MD = {
  paddingTop: "md",
  paddingBottom: "md",
  container: "default",
} as const;
const PAD_LG = {
  paddingTop: "lg",
  paddingBottom: "lg",
  container: "default",
} as const;
const PAD_XL = {
  paddingTop: "xl",
  paddingBottom: "xl",
  container: "default",
} as const;
/** The hero opens wider at the top than it closes at the bottom. */
/** The homepage's closing band, which sat wider than the standard CTA. */
const PAD_CTA_LARGE = {
  paddingTop: "3xl",
  paddingBottom: "3xl",
  container: "default",
  paddingClassName: "py-16 lg:py-24",
} as const;

const PAD_HERO = {
  paddingTop: "2xl",
  paddingBottom: "lg",
  container: "default",
} as const;

/** The image block's own width field, mapped onto the shared container tokens. */
const LEGACY_WIDTH = {
  container: "default",
  wide: "wide",
  full: "wide",
} as const;

/** Inline spans → React. No HTML string ever reaches the DOM (CLAUDE.md 11). */
function Inline({ spans }: { spans: readonly Span[] }) {
  return (
    <>
      {spans.map((span, index) => {
        const key = `${index}-${span.text.slice(0, 12)}`;
        let node: React.ReactNode = span.text;
        if (span.bold) node = <strong className="font-semibold text-navy-800">{node}</strong>;
        if (span.italic) node = <em>{node}</em>;
        if (span.href) {
          node = (
            <Link
              href={{ pathname: span.href }}
              className="text-brand-red-text underline underline-offset-2 hover:text-red-700"
            >
              {node}
            </Link>
          );
        }
        return <React.Fragment key={key}>{node}</React.Fragment>;
      })}
    </>
  );
}

export function RichBody({ body, className }: { body: string; className?: string }) {
  const paragraphs = parseInline(body);
  if (paragraphs.length === 0) return null;

  return (
    <div className={cn("space-y-5", className)}>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="text-lg leading-relaxed text-ink-muted">
          <Inline spans={paragraph.spans} />
        </p>
      ))}
    </div>
  );
}

function Figure({
  image,
  alt,
  caption,
  priority = false,
  className,
}: {
  image: BlockImage | undefined;
  alt: string | undefined;
  caption?: string | undefined;
  priority?: boolean;
  className?: string;
}) {
  if (!image) return null;

  // The block's own alt wins, then the library's. An empty string is a valid,
  // deliberate choice for a decorative image — so `??`, never `||`.
  const text = alt ?? image.alt ?? "";

  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-lg bg-surface-sunken">
        <Image
          src={image.url}
          alt={text}
          width={image.width ?? 1600}
          height={image.height ?? 900}
          sizes="(min-width: 1024px) 900px, 100vw"
          priority={priority}
          className="h-auto w-full object-cover"
        />
      </div>
      {caption ? (
        <figcaption className="mt-2.5 text-sm text-ink-subtle">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

export function HeadingBlock({
  content,
  images = {},
}: {
  content: BlockContent<"heading">;
  images?: BlockImages;
}) {
  const Tag = content.level === 3 ? "h3" : "h2";
  const centred = content.align === "center";

  return (
    <Band band={content.band} images={images} defaults={PAD_MD}>
      <Reveal>
        <div className={cn("max-w-3xl", centred && "mx-auto text-center")}>
          {content.eyebrow ? <Eyebrow className="mb-3">{content.eyebrow}</Eyebrow> : null}
          <Tag className={content.level === 3 ? "text-xl text-navy-800" : "text-3xl text-navy-800"}>
            {content.text}
          </Tag>
        </div>
      </Reveal>
    </Band>
  );
}

export function RichTextBlock({
  content,
  images = {},
}: {
  content: BlockContent<"richText">;
  images?: BlockImages;
}) {
  return (
    <Band band={content.band} images={images} defaults={PAD_MD}>
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
        {content.heading ? (
          <div className="lg:col-span-4">
            <Reveal>
              <h2 className="text-2xl text-navy-800">{content.heading}</h2>
            </Reveal>
          </div>
        ) : null}
        <div className={content.heading ? "lg:col-span-7 lg:col-start-6" : "lg:col-span-8"}>
          <Reveal delay={0.06}>
            <RichBody body={content.body} />
          </Reveal>
        </div>
      </div>
    </Band>
  );
}

export function ImageBlock({
  content,
  images,
}: {
  content: BlockContent<"image">;
  images: BlockImages;
}) {
  const image = content.mediaId ? images[content.mediaId] : undefined;
  if (!image) return null;

  if (content.width === "full") {
    return (
      <div className="py-10 lg:py-14">
        <Reveal>
          <Figure image={image} alt={content.alt} caption={content.caption} />
        </Reveal>
      </div>
    );
  }

  return (
    <Band
      band={content.band}
      images={images}
      defaults={{ ...PAD_MD, container: LEGACY_WIDTH[content.width] }}
    >
      <Reveal>
        <Figure image={image} alt={content.alt} caption={content.caption} />
      </Reveal>
    </Band>
  );
}

export function ImageBoxBlock({
  content,
  images,
}: {
  content: BlockContent<"imageBox">;
  images: BlockImages;
}) {
  return (
    <Band band={content.band} images={images} defaults={PAD_MD}>
      <Reveal>
        <div className="max-w-xl overflow-hidden rounded-lg border border-line bg-white">
          <Figure
            image={content.mediaId ? images[content.mediaId] : undefined}
            alt={content.alt}
            className="[&>div]:rounded-none"
          />
          <div className="p-5">
            <h3 className="font-display text-lg text-navy-800">{content.title}</h3>
            {content.text ? <p className="mt-2 text-ink-muted">{content.text}</p> : null}
            {content.ctaLabel && content.ctaHref ? (
              <div className="mt-4">
                <CtaButton href={{ pathname: content.ctaHref }}>{content.ctaLabel}</CtaButton>
              </div>
            ) : null}
          </div>
        </div>
      </Reveal>
    </Band>
  );
}

export function ImageTextBlock({
  content,
  images,
}: {
  content: BlockContent<"imageText">;
  images: BlockImages;
}) {
  const image = content.mediaId ? images[content.mediaId] : undefined;
  const imageFirst = content.imagePosition === "left";

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <div className="grid items-center gap-8 lg:grid-cols-12 lg:gap-14">
        <div
          className={cn("lg:col-span-6", imageFirst ? "lg:order-1" : "lg:order-2 lg:col-start-7")}
        >
          <Reveal>
            <Figure image={image} alt={content.alt} />
          </Reveal>
        </div>
        <div
          className={cn("lg:col-span-5", imageFirst ? "lg:order-2 lg:col-start-8" : "lg:order-1")}
        >
          <Reveal delay={0.06}>
            {content.eyebrow ? <Eyebrow className="mb-3">{content.eyebrow}</Eyebrow> : null}
            <h2 className="text-2xl text-navy-800">{content.heading}</h2>
            {content.body ? <RichBody body={content.body} className="mt-4" /> : null}
            {content.ctaLabel && content.ctaHref ? (
              <div className="mt-6">
                <CtaButton href={{ pathname: content.ctaHref }}>{content.ctaLabel}</CtaButton>
              </div>
            ) : null}
          </Reveal>
        </div>
      </div>
    </Band>
  );
}

export function TableBlock({
  content,
  images = {},
}: {
  content: BlockContent<"table">;
  images?: BlockImages;
}) {
  return (
    <Band band={content.band} images={images} defaults={PAD_MD}>
      <Reveal>
        {content.heading ? (
          <h2 className="mb-5 text-2xl text-navy-800">{content.heading}</h2>
        ) : null}
        {/* Wide tables scroll inside their own container; the page never does. */}
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[36rem] border-collapse text-left">
            {content.caption ? (
              <caption className="border-b border-line bg-surface-muted px-4 py-2.5 text-left text-sm text-ink-muted">
                {content.caption}
              </caption>
            ) : null}
            <thead>
              <tr className="bg-surface-muted">
                {content.headers.map((header, index) => (
                  <th
                    key={`${index}-${header}`}
                    scope="col"
                    className="border-b border-line px-4 py-2.5 text-sm font-semibold text-navy-800"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {content.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-line last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-4 py-2.5 align-top text-ink-muted">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
    </Band>
  );
}

export function FeatureBlock({
  content,
  images,
}: {
  content: BlockContent<"feature">;
  images: BlockImages;
}) {
  const image = content.mediaId ? images[content.mediaId] : undefined;

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-14">
        <div className={image ? "lg:col-span-6" : "lg:col-span-8"}>
          <Reveal>
            {content.eyebrow ? <Eyebrow className="mb-3">{content.eyebrow}</Eyebrow> : null}
            <h2 className="text-2xl text-navy-800">{content.heading}</h2>
            {content.body ? <RichBody body={content.body} className="mt-4" /> : null}
            {content.bullets.length > 0 ? (
              <ul className="mt-6 space-y-2.5">
                {content.bullets.map((bullet, index) => (
                  <li key={`${index}-${bullet.slice(0, 16)}`} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-red"
                    />
                    <span className="text-ink-muted">{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {content.ctaLabel && content.ctaHref ? (
              <div className="mt-7">
                <CtaButton href={{ pathname: content.ctaHref }}>{content.ctaLabel}</CtaButton>
              </div>
            ) : null}
          </Reveal>
        </div>
        {image ? (
          <div className="lg:col-span-5 lg:col-start-8">
            <Reveal delay={0.06}>
              <Figure image={image} alt={content.alt} />
            </Reveal>
          </div>
        ) : null}
      </div>
    </Band>
  );
}

/**
 * Grid column counts.
 *
 * Written out rather than interpolated, because Tailwind scans source text for
 * class names — a template literal produces a class that is never generated.
 * Every grid collapses to one column on mobile and steps up from `sm`.
 */
function BandHeader({
  eyebrow,
  heading,
  body,
}: {
  eyebrow?: string | undefined;
  heading?: string | undefined;
  body?: string | undefined;
}) {
  if (!eyebrow && !heading && !body) return null;
  return (
    <Reveal className="mb-8 max-w-2xl">
      {eyebrow ? <Eyebrow className="mb-3">{eyebrow}</Eyebrow> : null}
      {heading ? <h2 className="text-2xl text-navy-800">{heading}</h2> : null}
      {body ? <RichBody body={body} className="mt-4" /> : null}
    </Reveal>
  );
}

export function ListBlock({
  content,
  images = {},
}: {
  content: BlockContent<"list">;
  images?: BlockImages;
}) {
  const Tag = content.style === "numbered" ? "ol" : "ul";

  return (
    <Band band={content.band} images={images} defaults={PAD_MD}>
      <div className="max-w-2xl">
        {content.heading ? (
          <Reveal>
            <h2 className="mb-5 text-2xl text-navy-800">{content.heading}</h2>
          </Reveal>
        ) : null}
        <Reveal delay={0.06}>
          <Tag className={content.style === "numbered" ? "space-y-3" : "space-y-2.5"}>
            {content.items.map((item, index) => (
              <li key={`${index}-${item.slice(0, 16)}`} className="flex gap-3">
                {content.style === "numbered" ? (
                  <span
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 font-mono text-sm tabular-nums text-brand-red-text"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-red"
                  />
                )}
                <span className="text-lg leading-relaxed text-ink-muted">{item}</span>
              </li>
            ))}
          </Tag>
        </Reveal>
      </div>
    </Band>
  );
}

export function TextListBlock({
  content,
  images = {},
}: {
  content: BlockContent<"textList">;
  images?: BlockImages;
}) {
  return (
    <Band band={content.band} images={images} defaults={PAD_MD}>
      <div className="max-w-3xl">
        {content.heading ? (
          <Reveal>
            <h2 className="mb-6 text-2xl text-navy-800">{content.heading}</h2>
          </Reveal>
        ) : null}
        {/* A definition list: each point is a term and its explanation, which is
            exactly what a <dl> describes. */}
        <Stagger>
          <dl className="border-t border-line">
            {content.items.map((item, index) => (
              // The wrapper is StaggerItem's own div, not an extra one inside
              // it: HTML allows exactly one <div> grouping a dt/dd pair inside
              // a <dl>, and two levels makes the list invalid — axe reports it
              // as a serious violation and the pair stops being announced as a
              // term and its description.
              <StaggerItem
                key={`${index}-${item.title}`}
                className="grid gap-1.5 border-b border-line py-5 lg:grid-cols-12 lg:gap-6"
              >
                <dt className="font-display text-lg text-navy-800 lg:col-span-4">{item.title}</dt>
                {item.text ? (
                  <dd className="leading-relaxed text-ink-muted lg:col-span-8">{item.text}</dd>
                ) : (
                  <dd className="lg:col-span-8" />
                )}
              </StaggerItem>
            ))}
          </dl>
        </Stagger>
      </div>
    </Band>
  );
}

export function IconBlock({
  content,
  images = {},
}: {
  content: BlockContent<"icon">;
  images?: BlockImages;
}) {
  const centred = content.align === "center";

  return (
    <Band band={content.band} images={images} defaults={PAD_MD}>
      <Reveal>
        <div className={cn("max-w-2xl", centred && "mx-auto text-center")}>
          <span
            className={cn(
              "inline-flex size-11 items-center justify-center rounded-lg bg-red-50 text-brand-red-text",
              centred && "mx-auto",
            )}
          >
            <BlockIcon name={content.icon} />
          </span>
          <h2 className="mt-4 text-2xl text-navy-800">{content.heading}</h2>
          {content.body ? <RichBody body={content.body} className="mt-3" /> : null}
        </div>
      </Reveal>
    </Band>
  );
}

/** Card title, linked when the card has a destination. */
function CardTitle({ title, href }: { title: string; href?: string | undefined }) {
  if (!href) return <h3 className="font-display text-lg text-navy-800">{title}</h3>;
  return (
    <h3 className="font-display text-lg">
      <Link
        href={{ pathname: href }}
        className="text-navy-800 underline-offset-4 hover:text-brand-red-text hover:underline"
      >
        {title}
      </Link>
    </h3>
  );
}

/**
 * Card presentation, shared by every card-bearing block.
 *
 * Each control is a token that maps to a literal Tailwind class. None of these
 * strings are built at runtime: an interpolated class is invisible to
 * Tailwind's scanner, so the CSS would never be generated and the card would
 * quietly lose its styling in production only.
 */
const ASPECT: Record<string, string> = {
  auto: "",
  "1:1": "aspect-square",
  "4:3": "aspect-[4/3]",
  "3:2": "aspect-[3/2]",
  "16:9": "aspect-video",
  "21:9": "aspect-[21/9]",
};

const FIT: Record<string, string> = {
  cover: "object-cover",
  contain: "object-contain",
};

const OBJECT_POSITION: Record<string, string> = {
  center: "object-center",
  top: "object-top",
  bottom: "object-bottom",
  left: "object-left",
  right: "object-right",
};

const CARD_RADIUS: Record<string, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-2xl",
};

const CARD_STYLE: Record<string, string> = {
  flat: "bg-transparent",
  border: "border border-line bg-white",
  shadow: "border border-line bg-white shadow-sm",
  elevated: "bg-white shadow-md",
  glass: "border border-white/25 bg-white/10 backdrop-blur",
};

const CARD_OVERLAY: Record<string, string> = {
  none: "",
  dark: "after:absolute after:inset-0 after:bg-navy-900/35",
  light: "after:absolute after:inset-0 after:bg-white/35",
};

const ICON_TILE: Record<string, string> = {
  plain: "",
  tile: "inline-flex items-center justify-center rounded-md",
  circle: "inline-flex items-center justify-center rounded-full",
};

const ICON_TONE: Record<string, string> = {
  red: "bg-red-50 text-brand-red-text",
  navy: "bg-navy-50 text-navy-800",
  muted: "bg-surface-muted text-ink-muted",
};

/** The tone's text colour on its own, for an icon drawn without a tile. */
const ICON_TEXT: Record<string, string> = {
  red: "text-brand-red-text",
  navy: "text-navy-800",
  muted: "text-ink-muted",
};

const ICON_BOX: Record<string, string> = {
  sm: "size-8",
  md: "size-10",
  lg: "size-12",
};
const ICON_PX: Record<string, number> = { sm: 16, md: 20, lg: 24 };

const DEFAULT_TREATMENT = {
  aspect: "4:3",
  fit: "cover",
  position: "center",
  radius: "md",
  overlay: "none",
} as const;

/** A card image, rendered under the treatment the editor chose. */
function CardImage({
  image,
  hover,
  alt,
  decorative,
  treatment,
  className,
  sizes = "(min-width: 1024px) 380px, (min-width: 640px) 45vw, 100vw",
}: {
  image: BlockImage | undefined;
  hover?: BlockImage | undefined;
  alt: string;
  /** Hides the image from assistive technology; pairs with an empty alt. */
  decorative?: true | undefined;
  treatment:
    | typeof DEFAULT_TREATMENT
    | {
        aspect: string;
        fit: string;
        position: string;
        radius: string;
        overlay: string;
      };
  className?: string;
  sizes?: string;
}) {
  if (!image) return null;

  const frame = cn(
    "relative overflow-hidden bg-surface-sunken",
    ASPECT[treatment.aspect],
    CARD_RADIUS[treatment.radius],
    CARD_OVERLAY[treatment.overlay],
    hover ? "group" : "",
    className,
  );

  return (
    <div className={frame}>
      <Image
        src={image.url}
        alt={alt}
        aria-hidden={decorative}
        width={image.width ?? 800}
        height={image.height ?? 600}
        sizes={sizes}
        className={cn(
          "h-full w-full",
          FIT[treatment.fit],
          OBJECT_POSITION[treatment.position],
          hover ? "transition-opacity duration-(--duration-slow) group-hover:opacity-0" : "",
        )}
      />
      {hover ? (
        // Decorative by definition — it says nothing the first image did not —
        // so it carries an empty alt rather than repeating it (CLAUDE.md 12).
        <Image
          src={hover.url}
          alt=""
          width={hover.width ?? 800}
          height={hover.height ?? 600}
          sizes={sizes}
          aria-hidden="true"
          className={cn(
            "absolute inset-0 h-full w-full opacity-0 transition-opacity duration-(--duration-slow) group-hover:opacity-100",
            FIT[treatment.fit],
            OBJECT_POSITION[treatment.position],
          )}
        />
      ) : null}
    </div>
  );
}

function CardBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full bg-brand-red px-2.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-white">
      {label}
    </span>
  );
}

export function IconCardsBlock({
  content,
  images = {},
}: {
  content: BlockContent<"iconCards">;
  images?: BlockImages;
}) {
  const grid = resolveGrid(content);
  const cards = content.items.filter((item) => item.enabled !== false);
  if (cards.length === 0) return null;

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <BandHeader eyebrow={content.eyebrow} heading={content.heading} body={content.body} />
      <Stagger className={gridClasses(grid)}>
        {cards.map((item, index) => {
          const image = item.mediaId ? images[item.mediaId] : undefined;
          return (
            <StaggerItem key={`${index}-${item.title}`}>
              <div className={cn("h-full rounded-lg p-5", CARD_STYLE[content.cardStyle])}>
                {image ? (
                  <Image
                    src={image.url}
                    alt={item.alt ?? image.alt ?? ""}
                    width={image.width ?? 64}
                    height={image.height ?? 64}
                    sizes="48px"
                    className={cn("object-contain", ICON_BOX[content.iconSize])}
                  />
                ) : content.iconStyle === "plain" ? (
                  <span className={cn("inline-flex", ICON_TEXT[content.iconColor])}>
                    <BlockIcon name={item.icon} size={ICON_PX[content.iconSize]} />
                  </span>
                ) : (
                  <span
                    className={cn(
                      ICON_TILE[content.iconStyle],
                      ICON_TONE[content.iconColor],
                      ICON_BOX[content.iconSize],
                    )}
                  >
                    <BlockIcon name={item.icon} size={ICON_PX[content.iconSize]} />
                  </span>
                )}
                <div className="mt-3.5 space-y-1.5">
                  {item.badge ? <CardBadge label={item.badge} /> : null}
                  {item.eyebrow ? <Eyebrow>{item.eyebrow}</Eyebrow> : null}
                  <CardTitle title={item.title} href={item.href} />
                  {item.text ? <p className="text-ink-muted">{item.text}</p> : null}
                  {item.buttonLabel && item.buttonHref ? (
                    <div className="pt-2">
                      <CtaButton href={{ pathname: item.buttonHref }} variant="outline">
                        {item.buttonLabel}
                      </CtaButton>
                    </div>
                  ) : null}
                </div>
              </div>
            </StaggerItem>
          );
        })}
      </Stagger>
    </Band>
  );
}

export function ImageCardsBlock({
  content,
  images,
}: {
  content: BlockContent<"imageCards">;
  images: BlockImages;
}) {
  const grid = resolveGrid(content);
  const treatment = content.image ?? DEFAULT_TREATMENT;
  const cards = content.items.filter((item) => item.enabled !== false);
  if (cards.length === 0) return null;

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <BandHeader eyebrow={content.eyebrow} heading={content.heading} body={content.body} />
      <Stagger className={gridClasses(grid)}>
        {cards.map((item, index) => {
          const image = item.mediaId ? images[item.mediaId] : undefined;
          const hover = item.hoverMediaId ? images[item.hoverMediaId] : undefined;
          const bare = content.cardStyle === "flat";
          return (
            <StaggerItem key={`${index}-${item.title}`}>
              <article
                className={cn("h-full overflow-hidden rounded-lg", CARD_STYLE[content.cardStyle])}
              >
                <CardImage
                  image={image}
                  hover={hover}
                  alt={item.alt ?? image?.alt ?? ""}
                  treatment={treatment}
                  className={bare ? undefined : "rounded-none"}
                />
                <div className={cn("space-y-1.5", bare ? "pt-4" : "p-5")}>
                  {item.badge ? <CardBadge label={item.badge} /> : null}
                  {item.eyebrow ? <Eyebrow>{item.eyebrow}</Eyebrow> : null}
                  <div className="flex items-start gap-2">
                    {item.icon ? (
                      <span className="mt-1 text-brand-red-text">
                        <BlockIcon name={item.icon} size={18} />
                      </span>
                    ) : null}
                    <CardTitle title={item.title} href={item.href} />
                  </div>
                  {item.text ? <p className="text-ink-muted">{item.text}</p> : null}
                  {item.buttonLabel && item.buttonHref ? (
                    <div className="pt-2">
                      <CtaButton href={{ pathname: item.buttonHref }} variant="outline">
                        {item.buttonLabel}
                      </CtaButton>
                    </div>
                  ) : null}
                </div>
              </article>
            </StaggerItem>
          );
        })}
      </Stagger>
    </Band>
  );
}

/**
 * A `Reveal` only when asked for.
 *
 * Adding motion to a band that never had it changes every page already using
 * it, so the reveal is opt-in and the plain div is what everything else keeps
 * getting. Respects `prefers-reduced-motion` through `Reveal` either way.
 */
function RevealIf({
  active,
  delay,
  className,
  children,
}: {
  active: boolean;
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  if (!active) return <div className={className}>{children}</div>;
  return (
    <div className={className}>
      <Reveal {...(delay === undefined ? {} : { delay })}>{children}</Reveal>
    </div>
  );
}

export function CtaBlock({
  content,
  images = {},
}: {
  content: BlockContent<"cta">;
  images?: BlockImages;
}) {
  const dark = content.tone === "navy";
  const large = content.size === "large";

  return (
    <Band
      band={content.band}
      images={images}
      defaults={large ? PAD_CTA_LARGE : PAD_XL}
      // The tone is a class, so an editor's background — which is an inline
      // style — wins over it rather than fighting it.
      className={dark ? "bg-navy-800 text-white" : "border-y border-line bg-surface-muted"}
    >
      <div className={cn("grid lg:grid-cols-12 lg:items-end", large ? "gap-8" : "gap-6")}>
        {/*
          The large variant is the homepage's closing band, which reveals on
          scroll. The standard one does not, and gaining a reveal would be a
          change to every other page already using a CTA.
        */}
        <RevealIf active={large} className="lg:col-span-7">
          <h2
            className={cn(
              large ? "max-w-2xl text-4xl" : "text-3xl",
              dark ? "text-white" : "text-navy-800",
            )}
          >
            {content.heading}
          </h2>
          {content.body ? (
            <p
              className={cn(
                "max-w-xl",
                large ? "mt-5 text-lg" : "mt-4",
                dark ? "text-navy-100" : "text-ink-muted",
              )}
            >
              {content.body}
            </p>
          ) : null}
        </RevealIf>
        <RevealIf
          active={large}
          delay={0.1}
          className={cn(
            "flex flex-wrap gap-3 lg:col-span-4 lg:col-start-9 lg:justify-end",
            large && "lg:text-right",
          )}
        >
          <CtaButton href={{ pathname: content.ctaHref }} size="lg">
            {content.ctaLabel}
          </CtaButton>
          {content.secondaryLabel && content.secondaryHref ? (
            <CtaButton
              href={{ pathname: content.secondaryHref }}
              size="lg"
              variant={dark ? "onDark" : "outline"}
            >
              {content.secondaryLabel}
            </CtaButton>
          ) : null}
        </RevealIf>
      </div>
    </Band>
  );
}

export function FaqBlock({
  content,
  images = {},
}: {
  content: BlockContent<"faq">;
  images?: BlockImages;
}) {
  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <div className="max-w-3xl">
        {content.heading ? (
          <Reveal>
            <h2 className="mb-6 text-2xl text-navy-800">{content.heading}</h2>
          </Reveal>
        ) : null}
        {/*
          Native <details>/<summary>: keyboard operable, announced as expandable
          and correctly toggled by assistive technology, and it works before
          JavaScript loads. A hand-rolled accordion would need all of that
          rebuilt and would still be worse (CLAUDE.md 12).
        */}
        <div className="border-t border-line">
          {content.items.map((item, index) => (
            <details
              key={`${index}-${item.question.slice(0, 24)}`}
              className="group border-b border-line"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4 text-left font-display text-lg text-navy-800 marker:hidden hover:text-brand-red-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red">
                <span>{item.question}</span>
                <span
                  aria-hidden="true"
                  className="mt-1.5 shrink-0 text-ink-subtle transition-transform duration-(--duration-fast) group-open:rotate-45"
                >
                  <Plus size={18} />
                </span>
              </summary>
              <div className="pb-5">
                <RichBody body={item.answer} />
              </div>
            </details>
          ))}
        </div>
      </div>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// Layout blocks
// ---------------------------------------------------------------------------

/**
 * Two-column splits.
 *
 * Twelve columns, so every ratio the editor can choose lands on a whole number
 * and the two halves always add up. Literal classes, for the reason given
 * throughout this file.
 */
const SPLIT: Record<string, { text: string; media: string }> = {
  "50/50": { text: "lg:col-span-6", media: "lg:col-span-6" },
  "40/60": { text: "lg:col-span-5", media: "lg:col-span-7" },
  "60/40": { text: "lg:col-span-7", media: "lg:col-span-5" },
  "35/65": { text: "lg:col-span-4", media: "lg:col-span-8" },
  "65/35": { text: "lg:col-span-8", media: "lg:col-span-4" },
};

const COLUMN_ALIGN: Record<string, string> = {
  top: "lg:items-start",
  center: "lg:items-center",
  bottom: "lg:items-end",
};

/** Media first in the DOM only when it should also come first on screen. */
const MEDIA_ORDER: Record<string, string> = {
  left: "lg:order-first",
  right: "",
};

const BLOCK_HEIGHT: Record<string, string> = {
  auto: "",
  sm: "min-h-[18rem]",
  md: "min-h-[26rem]",
  lg: "min-h-[34rem]",
  screen: "min-h-dvh",
};

/**
 * Alt text for an image the editor may have marked decorative.
 *
 * A decorative image gets an empty alt and is hidden from assistive
 * technology; a meaningful one falls back to the media library's own
 * description. `??` and not `||`, because an empty string is a deliberate
 * choice here, not a missing value (CLAUDE.md 12).
 */
function altFor(
  decorative: boolean,
  alt: string | undefined,
  image: BlockImage | undefined,
): { alt: string; hidden: true | undefined } {
  if (decorative) return { alt: "", hidden: true };
  return { alt: alt ?? image?.alt ?? "", hidden: undefined };
}

function Buttons({
  label,
  href,
  secondaryLabel,
  secondaryHref,
  className,
}: {
  label?: string | undefined;
  href?: string | undefined;
  secondaryLabel?: string | undefined;
  secondaryHref?: string | undefined;
  className?: string;
}) {
  const primary = label && href;
  const secondary = secondaryLabel && secondaryHref;
  if (!primary && !secondary) return null;

  return (
    <div className={cn("flex flex-wrap gap-3", className)}>
      {primary ? (
        <CtaButton href={{ pathname: href! }} size="lg">
          {label}
        </CtaButton>
      ) : null}
      {secondary ? (
        <CtaButton href={{ pathname: secondaryHref! }} variant="outline" size="lg">
          {secondaryLabel}
        </CtaButton>
      ) : null}
    </div>
  );
}

export function TextImageBlock({
  content,
  images,
}: {
  content: BlockContent<"textImage">;
  images: BlockImages;
}) {
  const image = content.mediaId ? images[content.mediaId] : undefined;
  const split = SPLIT[content.split] ?? SPLIT["50/50"]!;
  const treatment = content.image ?? DEFAULT_TREATMENT;
  const sideAlt = altFor(content.decorative, content.alt, image);

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <div
        className={cn("grid gap-8 lg:grid-cols-12 lg:gap-12", COLUMN_ALIGN[content.verticalAlign])}
      >
        <div className={split.text}>
          <Reveal>
            {content.eyebrow ? <Eyebrow className="mb-3">{content.eyebrow}</Eyebrow> : null}
            <h2 className="text-3xl text-navy-800">{content.heading}</h2>
            {content.body ? <RichBody body={content.body} className="mt-5" /> : null}
            {content.bullets.length > 0 ? (
              <ul className="mt-6 space-y-2.5">
                {content.bullets.map((bullet, index) => (
                  <li key={`${index}-${bullet.slice(0, 20)}`} className="flex gap-3">
                    <span aria-hidden="true" className="mt-1 shrink-0 text-brand-red">
                      <BlockIcon name="check" size={17} />
                    </span>
                    <span className="text-ink-muted">{bullet}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <Buttons
              label={content.ctaLabel}
              href={content.ctaHref}
              secondaryLabel={content.secondaryLabel}
              secondaryHref={content.secondaryHref}
              className="mt-8"
            />
          </Reveal>
        </div>

        {image ? (
          <div className={cn(split.media, MEDIA_ORDER[content.imageSide])}>
            <Reveal delay={0.06}>
              <div
                className={cn(content.imageShadow && "shadow-lg", CARD_RADIUS[treatment.radius])}
              >
                <CardImage
                  image={image}
                  alt={sideAlt.alt}
                  decorative={sideAlt.hidden}
                  treatment={treatment}
                  sizes="(min-width: 1024px) 620px, 100vw"
                />
              </div>
            </Reveal>
          </div>
        ) : null}
      </div>
    </Band>
  );
}

const BENEFIT_MARKER: Record<string, string> = {
  check: "",
  circle: "inline-flex items-center justify-center rounded-full size-7",
  tile: "inline-flex items-center justify-center rounded-md size-7",
  image: "",
  none: "",
};

export function BenefitsBlock({
  content,
  images,
}: {
  content: BlockContent<"benefits">;
  images: BlockImages;
}) {
  const image = content.mediaId ? images[content.mediaId] : undefined;
  const split = SPLIT[content.split] ?? SPLIT["50/50"]!;
  const grid = resolveGrid(content);
  const treatment = content.image ?? DEFAULT_TREATMENT;
  const sideAlt = altFor(content.decorative, content.alt, image);
  const points = content.items.filter((item) => item.enabled !== false);

  const list = (
    <ul className={gridClasses(grid)}>
      {points.map((item, index) => {
        const marker = item.mediaId ? images[item.mediaId] : undefined;
        return (
          <li key={`${index}-${item.title}`} className="flex gap-3">
            {content.iconStyle === "none" ? null : marker ? (
              <Image
                src={marker.url}
                alt=""
                aria-hidden="true"
                width={marker.width ?? 28}
                height={marker.height ?? 28}
                sizes="28px"
                className="mt-0.5 size-7 shrink-0 object-contain"
              />
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 shrink-0",
                  BENEFIT_MARKER[content.iconStyle],
                  content.iconStyle === "check"
                    ? ICON_TEXT[content.iconColor]
                    : ICON_TONE[content.iconColor],
                )}
              >
                <BlockIcon name={item.icon} size={18} />
              </span>
            )}
            <div>
              {item.href ? (
                <Link
                  href={{ pathname: item.href }}
                  className="font-medium text-navy-800 underline-offset-4 hover:text-brand-red-text hover:underline"
                >
                  {item.title}
                </Link>
              ) : (
                <p className="font-medium text-navy-800">{item.title}</p>
              )}
              {item.text ? <p className="mt-1 text-ink-muted">{item.text}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );

  const copy = (
    <Reveal>
      {content.eyebrow ? <Eyebrow className="mb-3">{content.eyebrow}</Eyebrow> : null}
      {content.heading ? <h2 className="text-3xl text-navy-800">{content.heading}</h2> : null}
      {content.body ? <RichBody body={content.body} className="mt-5" /> : null}
      <div className="mt-7">{list}</div>
      <Buttons label={content.ctaLabel} href={content.ctaHref} className="mt-8" />
    </Reveal>
  );

  // With no image the copy takes the full width rather than sitting in half a
  // grid with an empty column beside it.
  if (!image) {
    return (
      <Band band={content.band} images={images} defaults={PAD_LG}>
        {copy}
      </Band>
    );
  }

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <div className="grid gap-10 lg:grid-cols-12 lg:items-center lg:gap-12">
        <div className={split.text}>{copy}</div>
        <div className={cn(split.media, MEDIA_ORDER[content.imageSide])}>
          <Reveal delay={0.06}>
            <CardImage
              image={image}
              alt={sideAlt.alt}
              decorative={sideAlt.hidden}
              treatment={treatment}
              sizes="(min-width: 1024px) 620px, 100vw"
            />
          </Reveal>
        </div>
      </div>
    </Band>
  );
}

const LOGO_TREATMENT: Record<string, string> = {
  "full-colour": "",
  muted: "opacity-70 transition-opacity duration-(--duration-fast) hover:opacity-100",
  monochrome: "grayscale transition-[filter] duration-(--duration-fast) hover:grayscale-0",
};

export function LogoGridBlock({
  content,
  images,
}: {
  content: BlockContent<"logoGrid">;
  images: BlockImages;
}) {
  const grid = resolveGrid(content);
  const logos = content.items.filter((item) => item.enabled !== false);
  if (logos.length === 0) return null;

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <BandHeader eyebrow={content.eyebrow} heading={content.heading} body={content.body} />
      <ul className={cn(gridClasses(grid), "items-center")}>
        {logos.map((item, index) => {
          const image = item.mediaId ? images[item.mediaId] : undefined;
          if (!image) return null;
          const label = item.alt ?? item.name ?? image.alt ?? "";
          const logo = (
            <Image
              src={image.url}
              alt={label}
              width={image.width ?? 200}
              height={image.height ?? 80}
              sizes="180px"
              className={cn(
                "h-10 w-auto max-w-full object-contain",
                LOGO_TREATMENT[content.treatment],
              )}
            />
          );
          return (
            <li key={`${index}-${item.mediaId}`} className="flex items-center justify-center">
              {item.href ? (
                <Link href={{ pathname: item.href }} className="inline-flex">
                  {logo}
                </Link>
              ) : (
                logo
              )}
            </li>
          );
        })}
      </ul>
    </Band>
  );
}

const TEXT_ALIGN: Record<string, string> = {
  left: "text-left",
  center: "mx-auto text-center",
  right: "ml-auto text-right",
};

export function FullWidthImageBlock({
  content,
  images,
}: {
  content: BlockContent<"fullWidthImage">;
  images: BlockImages;
}) {
  const image = content.mediaId ? images[content.mediaId] : undefined;
  if (!image) return null;

  const hasCopy = Boolean(content.heading ?? content.body ?? content.eyebrow);
  // Copy laid over the image says what the image says, so the image itself
  // becomes decoration rather than being announced twice.
  const fullAlt = altFor(content.decorative || hasCopy, content.alt, image);
  // Copy over an image is only readable with something behind it, and an
  // editor who turned the overlay off should not silently get white on white.
  const overlay = hasCopy && content.overlay === "none" ? "dark" : content.overlay;
  const inverted = overlay === "dark";

  return (
    <Band
      band={content.band}
      images={images}
      defaults={{
        paddingTop: "none",
        paddingBottom: "none",
        container: "full",
      }}
    >
      <div className={cn("relative overflow-hidden", BLOCK_HEIGHT[content.height])}>
        <Image
          src={image.url}
          alt={fullAlt.alt}
          aria-hidden={fullAlt.hidden}
          width={image.width ?? 2000}
          height={image.height ?? 900}
          sizes="100vw"
          className={cn(
            "h-full w-full",
            content.height === "auto" ? "" : "absolute inset-0",
            FIT[content.fit],
            OBJECT_POSITION[content.position],
          )}
        />
        {overlay !== "none" ? (
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0",
              overlay === "dark" ? "bg-navy-900/45" : "bg-white/45",
            )}
          />
        ) : null}
        {hasCopy ? (
          <Container className="relative flex min-h-full items-center py-16 lg:py-24">
            <div className={cn("max-w-2xl", TEXT_ALIGN[content.align])}>
              {content.eyebrow ? (
                <Eyebrow tone={inverted ? "light" : "red"} className="mb-3">
                  {content.eyebrow}
                </Eyebrow>
              ) : null}
              {content.heading ? (
                <h2 className={cn("text-3xl", inverted ? "text-white" : "text-navy-800")}>
                  {content.heading}
                </h2>
              ) : null}
              {content.body ? (
                <p className={cn("mt-4 text-lg", inverted ? "text-navy-100" : "text-ink-muted")}>
                  {content.body}
                </p>
              ) : null}
              <Buttons
                label={content.ctaLabel}
                href={content.ctaHref}
                className={cn("mt-7", content.align === "center" && "justify-center")}
              />
            </div>
          </Container>
        ) : null}
      </div>
    </Band>
  );
}

const HERO_IMAGE_SIZE: Record<string, string> = {
  auto: "",
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
};

/**
 * Hero.
 *
 * `stacked` is what every hero row created before the layout controls existed
 * resolves to, and it renders exactly the band those pages already had. The
 * other layouts are additions, never a change to what is already published.
 *
 * This is the one block that emits the page's <h1>; `EMITS_H1` in
 * page-sections.tsx knows it, so a page containing a hero does not also get a
 * title header prepended.
 */
export function HeroBlock({
  content,
  images = {},
}: {
  content: BlockContent<"hero">;
  images?: BlockImages;
}) {
  const image = content.mediaId ? images[content.mediaId] : undefined;
  const editorial = content.layout === "editorial";
  const sideways =
    Boolean(image) &&
    (content.layout === "text-image" ||
      content.layout === "image-text" ||
      content.layout === "split");
  const centred = content.layout === "centered";

  const copy = (
    <HeroReveal>
      {content.eyebrow ? <Eyebrow>{content.eyebrow}</Eyebrow> : null}
      <h1
        className={cn("mt-4 text-4xl text-navy-800", centred ? "mx-auto max-w-3xl" : "max-w-3xl")}
      >
        {content.heading}
      </h1>
      {content.body ? (
        <p
          className={cn(
            "mt-6 text-lg leading-relaxed text-ink-muted",
            centred ? "mx-auto max-w-2xl" : "max-w-xl",
          )}
        >
          {content.body}
        </p>
      ) : null}
      <Buttons
        label={content.ctaLabel}
        href={content.ctaHref}
        secondaryLabel={content.secondaryLabel}
        secondaryHref={content.secondaryHref}
        className={cn("mt-8", centred && "justify-center")}
      />
      {content.facts && content.facts.length > 0 ? (
        <dl className={cn("mt-10 flex flex-wrap gap-x-10 gap-y-4", centred && "justify-center")}>
          {content.facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-2xs uppercase tracking-widest text-ink-subtle">{fact.label}</dt>
              <dd className="mt-1 font-display text-xl text-navy-800">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </HeroReveal>
  );

  const heroAlt = altFor(content.decorative, content.alt, image);
  const picture = image ? (
    <div className={cn("w-full", HERO_IMAGE_SIZE[content.imageSize])}>
      <div className={cn("overflow-hidden bg-surface-sunken", CARD_RADIUS[content.imageRadius])}>
        <Image
          src={image.url}
          alt={heroAlt.alt}
          aria-hidden={heroAlt.hidden}
          width={image.width ?? 1200}
          height={image.height ?? 900}
          sizes="(min-width: 1024px) 560px, 100vw"
          priority
          className="h-auto w-full object-cover"
        />
      </div>
    </div>
  ) : null;

  if (editorial) {
    // The homepage's own hero, moved rather than rewritten: heading across
    // eight columns, copy and buttons in the remaining four, facts on a
    // hairline grid beneath.
    return (
      <Band
        band={content.band}
        images={images}
        defaults={{ ...PAD_HERO, paddingClassName: "pt-14 pb-12 lg:pt-24 lg:pb-16" }}
        className="border-b border-line"
      >
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-8">
            {content.eyebrow ? (
              <HeroReveal>
                <Eyebrow>{content.eyebrow}</Eyebrow>
              </HeroReveal>
            ) : null}
            <HeroReveal delay={0.08}>
              <h1 className="mt-4 max-w-4xl text-5xl text-navy-800">{content.heading}</h1>
            </HeroReveal>
          </div>

          <div className="lg:col-span-4 lg:pt-16">
            <HeroReveal delay={0.16}>
              {content.body ? (
                <p className="max-w-md text-lg leading-relaxed text-ink-muted">{content.body}</p>
              ) : null}
              <Buttons
                label={content.ctaLabel}
                href={content.ctaHref}
                secondaryLabel={content.secondaryLabel}
                secondaryHref={content.secondaryHref}
                className="mt-7"
              />
            </HeroReveal>
          </div>
        </div>

        {content.facts && content.facts.length > 0 ? (
          <HeroReveal delay={0.28}>
            <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden border-t border-line bg-line lg:grid-cols-4">
              {content.facts.map((fact) => (
                <div key={fact.label} className="bg-white px-1 pt-5 lg:px-0">
                  <dt className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                    {fact.label}
                  </dt>
                  <dd className="mt-1.5 font-display text-xl text-navy-800">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </HeroReveal>
        ) : null}

        {picture ? <div className="mt-10">{picture}</div> : null}
      </Band>
    );
  }

  return (
    <Band
      band={content.band}
      images={images}
      defaults={PAD_HERO}
      className="border-b border-line"
      contentClassName={cn(
        BLOCK_HEIGHT[content.height],
        content.height !== "auto" && "flex flex-col justify-center",
      )}
    >
      {sideways ? (
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
          <div>{copy}</div>
          <div
            className={cn(
              "flex",
              content.layout === "image-text" ? "lg:order-first" : "lg:justify-end",
            )}
          >
            {picture}
          </div>
        </div>
      ) : (
        <>
          {centred ? <div className="text-center">{copy}</div> : copy}
          {picture ? (
            <div className={cn("mt-10", centred && "flex justify-center")}>{picture}</div>
          ) : null}
        </>
      )}
    </Band>
  );
}
