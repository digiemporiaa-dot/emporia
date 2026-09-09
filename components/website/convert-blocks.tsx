import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { Container, Eyebrow } from "@/components/website/primitives";
import { Reveal, Stagger, StaggerItem } from "@/components/website/motion";
import { Band } from "@/components/website/band";
import { LeadForm } from "@/components/website/lead-form";
import { StickyCta } from "@/components/website/sticky-cta";
import { Tabs } from "@/components/website/tabs";
import { gridClasses, resolveGrid } from "@/lib/content/grid";
import { videoEmbedUrl, videoId } from "@/lib/content/video";
import { cn } from "@/lib/utils/cn";
import type { BlockContent } from "@/lib/content/blocks";
import type { BlockImages } from "@/components/website/blocks-shared";
import { Check, Minus } from "lucide-react";

/**
 * Conversion, trust and rich-content blocks.
 *
 * Kept apart from components/website/blocks.tsx purely for size — that file was
 * already 1,600 lines. The contract is identical: content arrives validated, an
 * image resolves from the batched `images` map, and every band renders through
 * `<Band>` so section-level width, spacing, background and breakpoint overrides
 * work here as they do everywhere else.
 *
 * Three of these are server components with a small client island inside
 * (`LeadForm`, `StickyCta`, `Tabs`) rather than being client components
 * themselves, so the copy and the layout still render on the server
 * (CLAUDE.md 2 rule 8).
 */

const PAD_MD = { paddingTop: "md", paddingBottom: "md", container: "default" } as const;
const PAD_LG = { paddingTop: "lg", paddingBottom: "lg", container: "default" } as const;

function Header({
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
    <Reveal>
      <div className="mb-8 max-w-2xl">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        {heading ? <h2 className="mt-2 text-2xl text-navy-800">{heading}</h2> : null}
        {body ? <p className="mt-3 text-ink-muted">{body}</p> : null}
      </div>
    </Reveal>
  );
}

const RATIO: Record<string, string> = {
  "1:1": "aspect-square",
  "4:3": "aspect-4/3",
  "3:2": "aspect-3/2",
  "16:9": "aspect-video",
  "21:9": "aspect-21/9",
};

const RADIUS: Record<string, string> = {
  none: "",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
};

const FIT: Record<string, string> = { cover: "object-cover", contain: "object-contain" };

const POSITION: Record<string, string> = {
  center: "object-center",
  top: "object-top",
  bottom: "object-bottom",
  left: "object-left",
  right: "object-right",
};

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export function LeadFormBlock({
  id,
  content,
  images = {},
}: {
  /** The PageSection id. The form posts it so the server can load this block. */
  id: string;
  content: BlockContent<"leadForm">;
  images?: BlockImages;
}) {
  const form = (
    <LeadForm
      sectionId={id}
      variant={content.variant}
      submitLabel={content.submitLabel}
      successMessage={content.successMessage}
      consentText={content.consentText}
      compact={content.layout === "beside"}
    />
  );

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      {content.layout === "beside" ? (
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          <div className="max-w-xl">
            {content.eyebrow ? <Eyebrow>{content.eyebrow}</Eyebrow> : null}
            {content.heading ? (
              <h2 className="mt-2 font-display text-3xl text-navy-800">{content.heading}</h2>
            ) : null}
            {content.body ? <p className="mt-4 text-ink-muted">{content.body}</p> : null}
          </div>
          <div>{form}</div>
        </div>
      ) : (
        <div className="max-w-xl">
          <Header eyebrow={content.eyebrow} heading={content.heading} body={content.body} />
          {form}
        </div>
      )}
    </Band>
  );
}

export function StickyCtaBlock({ content }: { content: BlockContent<"stickyCta"> }) {
  return (
    <StickyCta
      text={content.text}
      buttonLabel={content.buttonLabel}
      channel={content.channel}
      target={content.target}
      prefill={content.prefill}
      position={content.position}
      dismissible={content.dismissible}
      showAfterScroll={content.showAfterScroll}
    />
  );
}

// ---------------------------------------------------------------------------
// Trust
// ---------------------------------------------------------------------------

export function TeamBlock({
  content,
  images = {},
}: {
  content: BlockContent<"team">;
  images?: BlockImages;
}) {
  if (content.items.length === 0) return null;
  const grid = resolveGrid(content.grid);
  const image = content.image;

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <Header eyebrow={content.eyebrow} heading={content.heading} body={content.body} />
      <Stagger className={gridClasses(grid)}>
        {content.items.map((person, index) => {
          const photo = person.mediaId ? images[person.mediaId] : undefined;
          const card = (
            <>
              {photo ? (
                <div
                  className={cn(
                    "relative overflow-hidden bg-surface-muted",
                    RATIO[image?.aspect ?? "1:1"],
                    RADIUS[image?.radius ?? "md"],
                  )}
                >
                  <Image
                    src={photo.url}
                    alt={person.alt ?? photo.alt ?? ""}
                    fill
                    sizes="(min-width: 1024px) 24rem, 50vw"
                    className={cn(
                      FIT[image?.fit ?? "cover"],
                      POSITION[image?.position ?? "center"],
                    )}
                  />
                </div>
              ) : null}
              <p className="mt-3 font-display text-lg text-navy-800">{person.name}</p>
              {person.role ? (
                <p className="text-2xs uppercase tracking-widest text-ink-subtle">{person.role}</p>
              ) : null}
              {person.bio ? <p className="mt-2 text-sm text-ink-muted">{person.bio}</p> : null}
            </>
          );

          return (
            <StaggerItem key={`${index}-${person.name}`}>
              {person.linkHref ? (
                <Link
                  href={person.linkHref as Route}
                  className="block transition-opacity hover:opacity-90"
                >
                  {card}
                </Link>
              ) : (
                card
              )}
            </StaggerItem>
          );
        })}
      </Stagger>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export function GalleryBlock({
  content,
  images = {},
}: {
  content: BlockContent<"gallery">;
  images?: BlockImages;
}) {
  const shown = content.items.filter((item) => item.mediaId && images[item.mediaId]);
  if (shown.length === 0) return null;
  const grid = resolveGrid(content.grid);
  const image = content.image;

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <Header eyebrow={content.eyebrow} heading={content.heading} />
      <Stagger className={gridClasses(grid)}>
        {shown.map((item, index) => {
          const media = images[item.mediaId as string];
          if (!media) return null;
          return (
            <StaggerItem key={`${index}-${item.mediaId}`}>
              <figure>
                <div
                  className={cn(
                    "relative overflow-hidden bg-surface-muted",
                    RATIO[image?.aspect ?? "1:1"],
                    RADIUS[image?.radius ?? "md"],
                  )}
                >
                  <Image
                    src={media.url}
                    alt={item.alt ?? media.alt ?? ""}
                    fill
                    sizes="(min-width: 1024px) 20rem, 50vw"
                    className={cn(
                      FIT[image?.fit ?? "cover"],
                      POSITION[image?.position ?? "center"],
                    )}
                  />
                </div>
                {item.caption ? (
                  <figcaption className="mt-2 text-xs text-ink-subtle">{item.caption}</figcaption>
                ) : null}
              </figure>
            </StaggerItem>
          );
        })}
      </Stagger>
    </Band>
  );
}

const VIDEO_RATIO: Record<string, string> = {
  "16:9": "aspect-video",
  "4:3": "aspect-4/3",
  "1:1": "aspect-square",
};

const VIDEO_WIDTH: Record<string, string> = {
  container: "max-w-4xl",
  wide: "max-w-6xl",
  full: "",
};

export function VideoBlock({
  content,
  images = {},
}: {
  content: BlockContent<"video">;
  images?: BlockImages;
}) {
  const id = videoId(content.provider, content.video);
  const src = id ? videoEmbedUrl(content.provider, id) : null;
  // Nothing rather than an iframe pointed at whatever was typed. The builder
  // surfaces the same gap as a warning so it is visible before publishing.
  if (!src) return null;

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <div className={cn(VIDEO_WIDTH[content.width] ?? "max-w-4xl")}>
        <Header eyebrow={content.eyebrow} heading={content.heading} body={content.body} />
        <div className={cn("overflow-hidden rounded-lg bg-navy-900", VIDEO_RATIO[content.ratio])}>
          <iframe
            src={src}
            title={content.title}
            loading="lazy"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="h-full w-full border-0"
          />
        </div>
      </div>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export function TabsBlock({
  content,
  images = {},
}: {
  content: BlockContent<"tabs">;
  images?: BlockImages;
}) {
  if (content.items.length === 0) return null;
  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <div className="max-w-3xl">
        <Header eyebrow={content.eyebrow} heading={content.heading} />
        <Tabs items={content.items} />
      </div>
    </Band>
  );
}

export function TimelineBlock({
  content,
  images = {},
}: {
  content: BlockContent<"timeline">;
  images?: BlockImages;
}) {
  if (content.items.length === 0) return null;

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <div className="max-w-3xl">
        <Header eyebrow={content.eyebrow} heading={content.heading} />
        {/* An ordered list, because the order is the meaning. */}
        <ol className="border-l border-line">
          {content.items.map((step, index) => (
            <li key={`${index}-${step.title}`} className="relative pb-8 pl-6 last:pb-0">
              <span
                aria-hidden="true"
                className="absolute -left-1 top-1.5 h-2 w-2 rounded-full bg-brand-red"
              />
              {step.marker ? (
                <span className="text-2xs tabular-nums tracking-widest text-ink-subtle">
                  {step.marker}
                </span>
              ) : null}
              <p className="font-display text-lg text-navy-800">{step.title}</p>
              {step.body ? <p className="mt-1.5 text-sm text-ink-muted">{step.body}</p> : null}
            </li>
          ))}
        </ol>
      </div>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function Cell({ value }: { value: boolean | string }) {
  if (value === true) {
    return (
      <>
        <Check size={16} aria-hidden="true" className="mx-auto text-success" />
        <span className="sr-only">Included</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <Minus size={16} aria-hidden="true" className="mx-auto text-ink-subtle" />
        <span className="sr-only">Not included</span>
      </>
    );
  }
  return <span className="text-sm text-navy-800">{value}</span>;
}

export function ComparisonTableBlock({
  content,
  images = {},
}: {
  content: BlockContent<"comparisonTable">;
  images?: BlockImages;
}) {
  if (content.columns.length === 0 || content.rows.length === 0) return null;

  return (
    <Band band={content.band} images={images} defaults={PAD_LG}>
      <Header eyebrow={content.eyebrow} heading={content.heading} body={content.body} />
      {/* Scrolls inside its own container so a wide table never makes the page
          scroll sideways (CLAUDE.md 12, responsive). */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-3xl border-collapse text-left">
          <thead>
            <tr className="border-b border-line-strong">
              <th
                scope="col"
                className="py-3 pr-4 text-2xs uppercase tracking-widest text-ink-subtle"
              >
                <span className="sr-only">Feature</span>
              </th>
              {content.columns.map((column, index) => (
                <th
                  key={`${index}-${column.label}`}
                  scope="col"
                  className={cn(
                    "px-4 py-3 text-center align-bottom",
                    column.highlight && "bg-surface-muted",
                  )}
                >
                  <span className="font-display text-lg text-navy-800">{column.label}</span>
                  {column.detail ? (
                    <span className="mt-0.5 block text-xs text-ink-subtle">{column.detail}</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {content.rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row.label}`} className="border-b border-line">
                <th scope="row" className="py-3 pr-4 text-sm font-normal text-ink-muted">
                  {row.label}
                </th>
                {content.columns.map((column, columnIndex) => (
                  <td
                    key={`${columnIndex}-${column.label}`}
                    className={cn("px-4 py-3 text-center", column.highlight && "bg-surface-muted")}
                  >
                    {/* A row with fewer cells than columns is not an error: it
                        renders as blank rather than dropping the whole table. */}
                    <Cell value={row.cells[columnIndex] ?? ""} />
                  </td>
                ))}
              </tr>
            ))}
            {content.columns.some((column) => column.ctaLabel && column.ctaHref) ? (
              <tr>
                <td />
                {content.columns.map((column, index) => (
                  <td
                    key={`${index}-cta`}
                    className={cn("px-4 py-4 text-center", column.highlight && "bg-surface-muted")}
                  >
                    {column.ctaLabel && column.ctaHref ? (
                      <Link
                        href={column.ctaHref as Route}
                        className="inline-flex h-9.5 items-center rounded-md bg-brand-red px-4 text-sm font-medium text-white transition-colors hover:bg-red-600"
                      >
                        {column.ctaLabel}
                      </Link>
                    ) : null}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Band>
  );
}

export { Container, PAD_MD };
