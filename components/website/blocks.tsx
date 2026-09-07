import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Container, CtaButton, Eyebrow } from "@/components/website/primitives";
import { Reveal } from "@/components/website/motion";
import { parseInline, type Span } from "@/lib/content/inline";
import type { BlockContent } from "@/lib/content/blocks";
import { cn } from "@/lib/utils/cn";

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

export type BlockImage = {
  id: string;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
};
export type BlockImages = Readonly<Record<string, BlockImage>>;

const CONTAINER_WIDTH = {
  container: "page",
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

export function HeadingBlock({ content }: { content: BlockContent<"heading"> }) {
  const Tag = content.level === 3 ? "h3" : "h2";
  const centred = content.align === "center";

  return (
    <Container className="py-10 lg:py-14">
      <Reveal>
        <div className={cn("max-w-3xl", centred && "mx-auto text-center")}>
          {content.eyebrow ? <Eyebrow className="mb-3">{content.eyebrow}</Eyebrow> : null}
          <Tag className={content.level === 3 ? "text-xl text-navy-800" : "text-3xl text-navy-800"}>
            {content.text}
          </Tag>
        </div>
      </Reveal>
    </Container>
  );
}

export function RichTextBlock({ content }: { content: BlockContent<"richText"> }) {
  return (
    <Container className="py-10 lg:py-14">
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
    </Container>
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
    <Container width={CONTAINER_WIDTH[content.width]} className="py-10 lg:py-14">
      <Reveal>
        <Figure image={image} alt={content.alt} caption={content.caption} />
      </Reveal>
    </Container>
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
    <Container className="py-10 lg:py-14">
      <Reveal>
        <div className="max-w-xl overflow-hidden rounded-lg border border-line bg-white">
          <Figure image={content.mediaId ? images[content.mediaId] : undefined} alt={content.alt} className="[&>div]:rounded-none" />
          <div className="p-5">
            <h3 className="font-display text-lg text-navy-800">{content.title}</h3>
            {content.text ? <p className="mt-2 text-ink-muted">{content.text}</p> : null}
            {content.ctaLabel && content.ctaHref ? (
              <div className="mt-4">
                <CtaButton href={{ pathname: content.ctaHref }}>
                  {content.ctaLabel}
                </CtaButton>
              </div>
            ) : null}
          </div>
        </div>
      </Reveal>
    </Container>
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
    <Container className="py-12 lg:py-16">
      <div className="grid items-center gap-8 lg:grid-cols-12 lg:gap-14">
        <div
          className={cn(
            "lg:col-span-6",
            imageFirst ? "lg:order-1" : "lg:order-2 lg:col-start-7",
          )}
        >
          <Reveal>
            <Figure image={image} alt={content.alt} />
          </Reveal>
        </div>
        <div className={cn("lg:col-span-5", imageFirst ? "lg:order-2 lg:col-start-8" : "lg:order-1")}>
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
    </Container>
  );
}

export function TableBlock({ content }: { content: BlockContent<"table"> }) {
  return (
    <Container className="py-10 lg:py-14">
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
    </Container>
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
    <Container className="py-12 lg:py-16">
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
    </Container>
  );
}
