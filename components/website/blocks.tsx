import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Container, CtaButton, Eyebrow } from "@/components/website/primitives";
import { Reveal, Stagger, StaggerItem } from "@/components/website/motion";
import { parseInline, type Span } from "@/lib/content/inline";
import { Plus } from "lucide-react";
import { BlockIcon } from "@/components/website/icon";
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

/**
 * Grid column counts.
 *
 * Written out rather than interpolated, because Tailwind scans source text for
 * class names — a template literal produces a class that is never generated.
 * Every grid collapses to one column on mobile and steps up from `sm`.
 */
const COLUMNS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

function BandHeader({ eyebrow, heading }: { eyebrow?: string; heading?: string }) {
  if (!eyebrow && !heading) return null;
  return (
    <Reveal className="mb-8 max-w-2xl">
      {eyebrow ? <Eyebrow className="mb-3">{eyebrow}</Eyebrow> : null}
      {heading ? <h2 className="text-2xl text-navy-800">{heading}</h2> : null}
    </Reveal>
  );
}

export function ListBlock({ content }: { content: BlockContent<"list"> }) {
  const Tag = content.style === "numbered" ? "ol" : "ul";

  return (
    <Container className="py-10 lg:py-14">
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
    </Container>
  );
}

export function TextListBlock({ content }: { content: BlockContent<"textList"> }) {
  return (
    <Container className="py-10 lg:py-14">
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
    </Container>
  );
}

export function IconBlock({ content }: { content: BlockContent<"icon"> }) {
  const centred = content.align === "center";

  return (
    <Container className="py-10 lg:py-14">
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
    </Container>
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

export function IconCardsBlock({ content }: { content: BlockContent<"iconCards"> }) {
  return (
    <Container className="py-12 lg:py-16">
      <BandHeader eyebrow={content.eyebrow} heading={content.heading} />
      <Stagger className={cn("grid gap-5", COLUMNS[content.columns])}>
        {content.items.map((item, index) => (
          <StaggerItem key={`${index}-${item.title}`}>
            <div className="h-full rounded-lg border border-line bg-white p-5">
              <span className="inline-flex size-10 items-center justify-center rounded-md bg-red-50 text-brand-red-text">
                <BlockIcon name={item.icon} size={20} />
              </span>
              <div className="mt-3.5">
                <CardTitle title={item.title} href={item.href} />
                {item.text ? <p className="mt-1.5 text-ink-muted">{item.text}</p> : null}
              </div>
            </div>
          </StaggerItem>
        ))}
      </Stagger>
    </Container>
  );
}

export function ImageCardsBlock({
  content,
  images,
}: {
  content: BlockContent<"imageCards">;
  images: BlockImages;
}) {
  return (
    <Container className="py-12 lg:py-16">
      <BandHeader eyebrow={content.eyebrow} heading={content.heading} />
      <Stagger className={cn("grid gap-5", COLUMNS[content.columns])}>
        {content.items.map((item, index) => {
          const image = item.mediaId ? images[item.mediaId] : undefined;
          return (
            <StaggerItem key={`${index}-${item.title}`}>
              <article className="h-full overflow-hidden rounded-lg border border-line bg-white">
                {image ? (
                  <Image
                    src={image.url}
                    alt={item.alt ?? image.alt ?? ""}
                    width={image.width ?? 800}
                    height={image.height ?? 600}
                    sizes="(min-width: 1024px) 380px, (min-width: 640px) 45vw, 100vw"
                    className="aspect-[4/3] w-full object-cover"
                  />
                ) : null}
                <div className="p-5">
                  <CardTitle title={item.title} href={item.href} />
                  {item.text ? <p className="mt-1.5 text-ink-muted">{item.text}</p> : null}
                </div>
              </article>
            </StaggerItem>
          );
        })}
      </Stagger>
    </Container>
  );
}

export function CtaBlock({ content }: { content: BlockContent<"cta"> }) {
  const dark = content.tone === "navy";

  return (
    <section className={dark ? "bg-navy-800 text-white" : "border-y border-line bg-surface-muted"}>
      <Container className="py-14 lg:py-18">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <h2 className={cn("text-3xl", dark ? "text-white" : "text-navy-800")}>
              {content.heading}
            </h2>
            {content.body ? (
              <p className={cn("mt-4 max-w-xl", dark ? "text-navy-100" : "text-ink-muted")}>
                {content.body}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3 lg:col-span-4 lg:col-start-9 lg:justify-end">
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
          </div>
        </div>
      </Container>
    </section>
  );
}

export function FaqBlock({ content }: { content: BlockContent<"faq"> }) {
  return (
    <Container className="py-12 lg:py-16">
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
            <details key={`${index}-${item.question.slice(0, 24)}`} className="group border-b border-line">
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
    </Container>
  );
}
