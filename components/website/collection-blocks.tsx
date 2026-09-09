import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLink, CtaButton, Eyebrow, IndexNumber } from "@/components/website/primitives";
import { Reveal, Stagger, StaggerItem } from "@/components/website/motion";
import { Counter } from "@/components/website/counter";
import { Band } from "@/components/website/band";
import { BlockIcon } from "@/components/website/icon";
import { ICON_NAMES, type IconName } from "@/lib/content/icons";
import { RichBody } from "@/components/website/blocks";
import { gridClasses, gridColumnClasses, resolveGrid } from "@/lib/content/grid";
import { byName, byOldest, matches, select, type PageCollections } from "@/lib/content/collections";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils/cn";
import type { BlockContent } from "@/lib/content/blocks";
import type { BlockImages } from "@/components/website/blocks-shared";

/**
 * Renderers for the dynamic collection blocks.
 *
 * The markup here is the homepage's, moved rather than rewritten. Each of these
 * bands was hand-composed in `app/(website)/page.tsx`; lifting it into a block
 * is what makes it editable without redesigning it, so the site looks the same
 * the moment the homepage becomes a CMS page (CLAUDE.md 2 rule 10).
 *
 * All server components. The data arrives pre-resolved from
 * `lib/content/collections.ts`, so a page issues one query per collection no
 * matter how many blocks read it, and none of this ships to the browser.
 */

/**
 * The padding the homepage's bands had before they were section types.
 *
 * `py-16 lg:py-24` is not on the editor's spacing scale, and adding a token for
 * it would grow the picker to preserve one value. `paddingClassName` is the
 * escape for exactly this: the band's historical padding, used while the editor
 * has set none of their own (lib/content/presentation.ts).
 */
const PAD_BAND = {
  paddingTop: "3xl",
  paddingBottom: "3xl",
  container: "default",
  paddingClassName: "py-16 lg:py-24",
} as const;

/** The shorter bands — insights, industries — closed at `lg:py-20`. */
const PAD_BAND_SHORT = {
  paddingTop: "3xl",
  paddingBottom: "2xl",
  container: "default",
  paddingClassName: "py-16 lg:py-20",
} as const;

/**
 * A Service's `icon` column is free text, set before the curated set existed.
 * A name outside the set renders nothing rather than crashing the band.
 */
function isIconName(value: string | null): value is IconName {
  return value !== null && (ICON_NAMES as readonly string[]).includes(value);
}

function BandHead({
  eyebrow,
  heading,
  body,
  linkLabel,
  linkHref,
  tone = "dark",
  size = "lg",
}: {
  eyebrow?: string | undefined;
  heading?: string | undefined;
  body?: string | undefined;
  linkLabel?: string | undefined;
  linkHref?: string | undefined;
  tone?: "dark" | "light";
  /** The insights band opens smaller than the services and packages bands do. */
  size?: "md" | "lg";
}) {
  if (!eyebrow && !heading && !body && !linkLabel) return null;

  const head = (
    <>
      <Reveal>
        {eyebrow ? <Eyebrow tone={tone === "light" ? "light" : "red"}>{eyebrow}</Eyebrow> : null}
        {heading ? (
          <h2
            className={cn(
              "mt-4",
              size === "md" ? "text-2xl" : "max-w-xl text-3xl",
              tone === "light" ? "text-white" : "text-navy-800",
            )}
          >
            {heading}
          </h2>
        ) : null}
        {body ? <RichBody body={body} className="mt-4 max-w-2xl" /> : null}
      </Reveal>
    </>
  );

  // The flex row exists to put a link opposite the heading. Without one it is
  // a wrapper around a single child, so it is not emitted.
  if (!linkLabel || !linkHref) return head;

  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      {head}
      <Reveal delay={0.1}>
        <ArrowLink href={{ pathname: linkHref }}>{linkLabel}</ArrowLink>
      </Reveal>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function ClientStripBlock({
  content,
  collections,
  images = {},
}: {
  content: BlockContent<"clientStrip">;
  collections: PageCollections;
  images?: BlockImages;
}) {
  const studies = collections.caseStudies.slice(0, content.limit);
  if (studies.length === 0) return null;

  return (
    <Band
      band={content.band}
      images={images}
      defaults={{ paddingTop: "none", paddingBottom: "none", container: "default" }}
      className="border-b border-line bg-surface-muted py-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
        <p className="shrink-0 text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          {content.label ?? "Selected clients"}
        </p>
        <ul className="flex flex-wrap items-center gap-x-8 gap-y-2">
          {studies.map((study) => (
            <li key={study.id} className="font-display text-sm text-navy-700">
              {study.clientName}
            </li>
          ))}
        </ul>
      </div>
    </Band>
  );
}

export function ServiceGridBlock({
  content,
  collections,
  images = {},
}: {
  content: BlockContent<"serviceGrid">;
  collections: PageCollections;
  images?: BlockImages;
}) {
  const services = select(collections.services, content.mode, content.ids, content.limit, {
    sort: content.sort === "name" ? byName : undefined,
  });
  // An empty state beats an empty band: a page with no published services
  // simply does not show this section (CLAUDE.md 2 rule 5).
  if (services.length === 0) return null;

  const grid = resolveGrid(content);

  return (
    <Band band={content.band} images={images} defaults={PAD_BAND} className="border-b border-line">
      <BandHead
        eyebrow={content.eyebrow}
        heading={content.heading}
        body={content.body}
        linkLabel={content.linkLabel}
        linkHref={content.linkHref}
      />

      {content.layout === "cards" ? (
        <Stagger className={cn("mt-12", gridClasses(grid))}>
          {services.map((service) => (
            <StaggerItem key={service.id}>
              <Link
                href={`/services/${service.slug}`}
                className="group flex h-full flex-col rounded-lg border border-line bg-white p-6 transition-colors hover:border-navy-300"
              >
                {isIconName(service.icon) ? (
                  <span className="inline-flex size-10 items-center justify-center rounded-md bg-red-50 text-brand-red-text">
                    <BlockIcon name={service.icon} size={20} />
                  </span>
                ) : null}
                <h3 className="mt-3.5 font-display text-lg text-navy-800 group-hover:text-brand-red">
                  {service.name}
                </h3>
                <p className="mt-1.5 text-ink-muted">{service.shortDescription}</p>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      ) : (
        <Stagger className="mt-12 border-t border-line">
          {services.map((service, index) => (
            <StaggerItem key={service.id}>
              <Link
                href={`/services/${service.slug}`}
                className="group grid items-baseline gap-2 border-b border-line py-6 transition-colors duration-(--duration-fast) hover:bg-surface-muted lg:grid-cols-12 lg:gap-6 lg:px-2"
              >
                <div className="flex items-baseline gap-4 lg:col-span-5">
                  <IndexNumber value={index + 1} />
                  <h3 className="font-display text-xl text-navy-800 transition-colors group-hover:text-brand-red">
                    {service.name}
                  </h3>
                </div>
                <p className="text-ink-muted lg:col-span-6">{service.shortDescription}</p>
                <span
                  aria-hidden="true"
                  className="hidden text-brand-red opacity-0 transition-opacity duration-(--duration-fast) group-hover:opacity-100 lg:col-span-1 lg:block lg:text-right"
                >
                  →
                </span>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </Band>
  );
}

export function PackageGridBlock({
  content,
  collections,
  images = {},
}: {
  content: BlockContent<"packageGrid">;
  collections: PageCollections;
  images?: BlockImages;
}) {
  const packages = select(collections.packages, content.mode, content.ids, content.limit, {
    where: (pkg) =>
      matches(content.serviceSlug, pkg.service?.slug) &&
      (!content.recommendedOnly || pkg.isRecommended),
  });
  if (packages.length === 0) return null;

  const grid = resolveGrid({ grid: content.grid, columns: 3 });

  return (
    <Band band={content.band} images={images} defaults={PAD_BAND} className="border-b border-line">
      <BandHead
        eyebrow={content.eyebrow}
        heading={content.heading}
        body={content.body}
        linkLabel={content.linkLabel}
        linkHref={content.linkHref}
      />
      <Stagger className={cn("mt-12 gap-px bg-line", gridColumnClasses(grid))}>
        {packages.map((pkg) => (
          <StaggerItem key={pkg.id} className="min-w-0 bg-white">
            <Link
              href={`/packages/${pkg.slug}`}
              className="group flex h-full flex-col p-7 transition-colors hover:bg-surface-muted"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-display text-lg text-navy-800">{pkg.name}</h3>
                {pkg.isRecommended ? (
                  <span className="rounded-xs bg-brand-red px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-white">
                    Most chosen
                  </span>
                ) : null}
              </div>
              {pkg.tagline ? <p className="mt-2.5 text-sm text-ink-muted">{pkg.tagline}</p> : null}
              {/* A Decimal string straight from the column; nothing here casts
                  money to a number (CLAUDE.md 2 rule 1). */}
              <p className="mt-6 font-display text-3xl tabular-nums text-navy-800">
                {formatMoney(pkg.price, pkg.currency)}
              </p>
              <p className="mt-1 text-xs text-ink-subtle">
                {pkg.billingType === "RETAINER" ? "per month, retainer" : "per month"} · excl. tax
              </p>
              <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-red-text">
                What is included
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                  →
                </span>
              </span>
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </Band>
  );
}

export function BlogGridBlock({
  content,
  collections,
  images = {},
}: {
  content: BlockContent<"blogGrid">;
  collections: PageCollections;
  images?: BlockImages;
}) {
  const posts = select(collections.posts, content.mode, content.ids, content.limit, {
    where: (post) =>
      matches(content.categorySlug, post.category?.slug) &&
      (!content.tagSlug || post.tags.includes(content.tagSlug)),
    sort: content.sort === "oldest" ? byOldest : undefined,
  });
  if (posts.length === 0) return null;

  const grid = resolveGrid(content);

  return (
    <Band
      band={content.band}
      images={images}
      defaults={PAD_BAND_SHORT}
      className="border-b border-line"
    >
      <BandHead
        eyebrow={content.eyebrow}
        heading={content.heading}
        body={content.body}
        linkLabel={content.linkLabel}
        linkHref={content.linkHref}
        size="md"
      />

      {content.layout === "cards" ? (
        <Stagger className={cn("mt-10", gridClasses(grid))}>
          {posts.map((post) => (
            <StaggerItem key={post.id}>
              <Link
                href={`/blog/${post.slug}`}
                className="group flex h-full flex-col rounded-lg border border-line bg-white p-6 transition-colors hover:border-navy-300"
              >
                <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                  {post.category?.name ?? "Article"}
                </p>
                <h3 className="mt-2.5 font-display text-lg text-navy-800 group-hover:text-brand-red">
                  {post.title}
                </h3>
                {post.excerpt ? (
                  <p className="mt-3 flex-1 text-sm text-ink-muted">{post.excerpt}</p>
                ) : null}
                <p className="mt-5 text-xs text-ink-subtle">{post.readingMinutes} min read</p>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      ) : (
        <Stagger className="mt-10 border-t border-line">
          {posts.map((post) => (
            <StaggerItem key={post.id}>
              <Link
                href={`/blog/${post.slug}`}
                className="group grid gap-1.5 border-b border-line py-5 transition-colors hover:bg-surface-muted lg:grid-cols-12 lg:items-baseline lg:gap-6 lg:px-2"
              >
                <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle lg:col-span-2">
                  {post.category?.name ?? "Article"}
                </p>
                <h3 className="font-display text-lg text-navy-800 transition-colors group-hover:text-brand-red lg:col-span-8">
                  {post.title}
                </h3>
                <p className="text-xs text-ink-subtle lg:col-span-2 lg:text-right">
                  {post.readingMinutes} min read
                </p>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </Band>
  );
}

export function CaseStudyGridBlock({
  content,
  collections,
  images = {},
}: {
  content: BlockContent<"caseStudyGrid">;
  collections: PageCollections;
  images?: BlockImages;
}) {
  const studies = select(collections.caseStudies, content.mode, content.ids, content.limit, {
    where: (study) =>
      matches(content.serviceSlug, study.service?.slug) &&
      matches(content.citySlug, study.city?.slug),
  });
  if (studies.length === 0) return null;

  const grid = resolveGrid(content);
  const [featured, ...secondary] = studies;

  return (
    <Band band={content.band} images={images} defaults={PAD_BAND} className="border-b border-line">
      <BandHead eyebrow={content.eyebrow} heading={content.heading} body={content.body} />

      {content.layout === "editorial" && featured ? (
        <>
          <Reveal delay={0.06}>
            <Link
              href={`/case-studies/${featured.slug}`}
              className="group mt-8 block border-t-2 border-navy-800 pt-8"
            >
              <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
                <div className="lg:col-span-7">
                  <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                    {featured.clientName}
                    {featured.service ? ` · ${featured.service.name}` : ""}
                  </p>
                  <h3 className="mt-3 max-w-2xl text-3xl text-navy-800 transition-colors group-hover:text-brand-red">
                    {featured.title}
                  </h3>
                  <p className="mt-4 max-w-xl text-ink-muted">{featured.summary}</p>
                </div>
                <div className="lg:col-span-4 lg:col-start-9">
                  <dl className="grid grid-cols-2 gap-y-6">
                    {featured.metrics.slice(0, 4).map((metric) => (
                      <div key={metric.label}>
                        <dd className="font-display text-2xl tabular-nums text-navy-800">
                          {metric.value}
                          <span className="text-brand-red">{metric.unit}</span>
                        </dd>
                        <dt className="mt-1 text-xs text-ink-subtle">{metric.label}</dt>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
            </Link>
          </Reveal>

          {secondary.length > 0 ? (
            <Stagger className="mt-12 grid gap-px bg-line sm:grid-cols-2">
              {secondary.map((study) => (
                <StaggerItem key={study.id} className="bg-white">
                  <Link
                    href={`/case-studies/${study.slug}`}
                    className="group flex h-full flex-col p-6 transition-colors hover:bg-surface-muted sm:p-7"
                  >
                    <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                      {study.clientName}
                    </p>
                    <h3 className="mt-2.5 font-display text-lg text-navy-800 transition-colors group-hover:text-brand-red">
                      {study.title}
                    </h3>
                    <p className="mt-3 flex-1 text-sm text-ink-muted">{study.summary}</p>
                    {study.metrics[0] ? (
                      <p className="mt-5 font-display text-xl tabular-nums text-navy-800">
                        {study.metrics[0].value}
                        <span className="text-brand-red">{study.metrics[0].unit}</span>
                        <span className="ml-2 align-middle text-xs font-normal text-ink-subtle">
                          {study.metrics[0].label}
                        </span>
                      </p>
                    ) : null}
                  </Link>
                </StaggerItem>
              ))}
            </Stagger>
          ) : null}
        </>
      ) : (
        <Stagger className={cn("mt-10", gridClasses(grid))}>
          {studies.map((study) => (
            <StaggerItem key={study.id}>
              <Link
                href={`/case-studies/${study.slug}`}
                className="group flex h-full flex-col rounded-lg border border-line bg-white p-6 transition-colors hover:border-navy-300"
              >
                <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                  {study.clientName}
                </p>
                <h3 className="mt-2.5 font-display text-lg text-navy-800 group-hover:text-brand-red">
                  {study.title}
                </h3>
                <p className="mt-3 flex-1 text-sm text-ink-muted">{study.summary}</p>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {content.linkLabel && content.linkHref ? (
        <div className="mt-10">
          <ArrowLink href={{ pathname: content.linkHref }}>{content.linkLabel}</ArrowLink>
        </div>
      ) : null}
    </Band>
  );
}

export function TestimonialsBlock({
  content,
  collections,
  images = {},
}: {
  content: BlockContent<"testimonials">;
  collections: PageCollections;
  images?: BlockImages;
}) {
  const quotes = select(collections.testimonials, content.mode, content.ids, content.limit, {
    where: (quote) =>
      matches(content.serviceSlug, quote.service?.slug) &&
      matches(content.citySlug, quote.city?.slug) &&
      // An unrated testimonial is excluded once a minimum is set: no rating is
      // not evidence of a good one.
      (content.minRating === undefined || (quote.rating ?? 0) >= content.minRating),
  });
  if (quotes.length === 0) return null;

  const grid = resolveGrid({ grid: content.grid, columns: 2 });

  return (
    <Band band={content.band} images={images} defaults={PAD_BAND} className="border-b border-line">
      <BandHead eyebrow={content.eyebrow} heading={content.heading} body={content.body} />

      {content.layout === "cards" ? (
        <div className={cn(content.heading ? "mt-10" : "", gridClasses(grid))}>
          {quotes.map((quote, index) => (
            <Reveal key={quote.id} delay={index * 0.08}>
              <figure className="flex h-full flex-col rounded-lg border border-line bg-white p-6">
                <blockquote className="flex-1 text-navy-800">{quote.quote}</blockquote>
                <figcaption className="mt-5 border-t border-line pt-4 text-sm">
                  <span className="font-medium text-navy-800">{quote.authorName}</span>
                  <span className="text-ink-subtle">
                    {quote.authorRole ? ` · ${quote.authorRole}` : ""}
                    {quote.company ? `, ${quote.company}` : ""}
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      ) : (
        <div className={cn(content.heading ? "mt-10" : "", "grid gap-12 lg:grid-cols-2 lg:gap-16")}>
          {quotes.map((quote, index) => (
            <Reveal key={quote.id} delay={index * 0.08}>
              <figure className={index === 1 ? "lg:pt-16" : undefined}>
                <span
                  aria-hidden="true"
                  className="font-display text-4xl leading-none text-brand-red"
                >
                  &ldquo;
                </span>
                <blockquote className="mt-3 font-display text-2xl leading-snug text-navy-800">
                  {quote.quote}
                </blockquote>
                <figcaption className="mt-6 border-t border-line pt-4 text-sm">
                  <span className="font-medium text-navy-800">{quote.authorName}</span>
                  <span className="text-ink-subtle">
                    {quote.authorRole ? ` · ${quote.authorRole}` : ""}
                    {quote.company ? `, ${quote.company}` : ""}
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      )}
    </Band>
  );
}

/**
 * Split "3.4x" or "+128%" into the pieces the counter animates.
 *
 * Lifted from the homepage, where it already did this job. A value that is not
 * a number at all is printed as written rather than mangled.
 */
function splitMetric(value: string): {
  prefix: string;
  number: number | null;
  unit: string;
  decimals: number;
} {
  const match = /^([+-]?)(\d+(?:\.(\d+))?)$/.exec(value.trim());
  if (!match) return { prefix: "", number: null, unit: "", decimals: 0 };
  return {
    prefix: match[1] ?? "",
    number: Number(match[2]),
    unit: "",
    decimals: match[3]?.length ?? 0,
  };
}

export function StatsBlock({
  content,
  collections,
  images = {},
}: {
  content: BlockContent<"stats">;
  collections: PageCollections;
  images?: BlockImages;
}) {
  // Real numbers or none: the metrics source reads published case-study
  // metrics, and the entered source is what an editor typed. Neither invents
  // anything (CLAUDE.md 16).
  const items =
    content.source === "metrics"
      ? // One headline metric per case study, not every metric of the first
        // one: three numbers from three engagements says more than three from
        // the same client.
        collections.caseStudies.slice(0, content.limit).flatMap((study) =>
          study.metrics.slice(0, 1).map((metric) => ({
            prefix: undefined as string | undefined,
            value: metric.value,
            suffix: metric.unit ?? undefined,
            label: metric.label,
            text: study.clientName,
            icon: undefined as string | undefined,
          })),
        )
      : content.items.slice(0, content.limit);

  if (items.length === 0) return null;

  const dark = content.tone === "dark";
  const grid = resolveGrid({ grid: content.grid, columns: Math.min(items.length, 4) });

  return (
    <Band
      band={content.band}
      images={images}
      defaults={PAD_BAND}
      className={dark ? "bg-navy-800 text-white" : "border-b border-line"}
    >
      {content.eyebrow || content.heading || content.body ? (
        <Reveal>
          {content.eyebrow ? (
            <Eyebrow tone={dark ? "light" : "red"}>{content.eyebrow}</Eyebrow>
          ) : null}
          {content.heading ? (
            <h2 className={cn("mt-4 max-w-2xl text-3xl", dark ? "text-white" : "text-navy-800")}>
              {content.heading}
            </h2>
          ) : null}
          {content.body ? (
            <p className={cn("mt-4", dark ? "text-navy-100" : "text-ink-muted")}>{content.body}</p>
          ) : null}
        </Reveal>
      ) : null}

      <dl
        className={cn(
          "mt-12 gap-px overflow-hidden",
          dark ? "bg-navy-700" : "bg-line",
          gridColumnClasses(grid),
        )}
      >
        {items.map((item, index) => {
          const parsed = splitMetric(item.value);
          return (
            // A dl's div wrapper may hold only dt and dd, and the term must
            // precede its description. The visual order — big number first — is
            // restored with flex ordering rather than invalid markup.
            <div
              key={`${index}-${item.label}`}
              className={cn("flex flex-col px-1 py-6 sm:px-6", dark ? "bg-navy-800" : "bg-white")}
            >
              <dt className={cn("order-2 mt-3 text-sm", dark ? "text-navy-100" : "text-ink-muted")}>
                {item.label}
                {item.text ? (
                  <span
                    className={cn("mt-1 block text-xs", dark ? "text-navy-300" : "text-ink-subtle")}
                  >
                    {item.text}
                  </span>
                ) : null}
              </dt>
              <dd
                className={cn(
                  "order-1 font-display text-5xl tabular-nums",
                  dark ? "text-white" : "text-navy-800",
                )}
              >
                {item.prefix ?? parsed.prefix}
                {parsed.number === null || !content.animate ? (
                  item.value
                ) : (
                  <Counter value={parsed.number} decimals={parsed.decimals} />
                )}
                <span className="text-brand-red">{item.suffix ?? parsed.unit}</span>
              </dd>
            </div>
          );
        })}
      </dl>
    </Band>
  );
}

// ---------------------------------------------------------------------------
// Static blocks that belong with these
// ---------------------------------------------------------------------------

const CARD_SURFACE: Record<string, string> = {
  flat: "bg-transparent",
  border: "border border-line bg-white",
  shadow: "border border-line bg-white shadow-sm",
  elevated: "bg-white shadow-md",
  glass: "border border-white/25 bg-white/10 backdrop-blur",
};

export function FeatureCardsBlock({
  content,
  images = {},
}: {
  content: BlockContent<"featureCards">;
  images?: BlockImages;
}) {
  const grid = resolveGrid(content);
  const items = content.items.filter((item) => item.enabled !== false);
  if (items.length === 0) return null;
  const sideways = content.iconPlacement === "left";

  return (
    <Band
      band={content.band}
      images={images}
      defaults={{ paddingTop: "lg", paddingBottom: "lg", container: "default" }}
    >
      {content.eyebrow || content.heading || content.body ? (
        <Reveal className="mb-8 max-w-2xl">
          {content.eyebrow ? <Eyebrow className="mb-3">{content.eyebrow}</Eyebrow> : null}
          {content.heading ? <h2 className="text-2xl text-navy-800">{content.heading}</h2> : null}
          {content.body ? <RichBody body={content.body} className="mt-4" /> : null}
        </Reveal>
      ) : null}

      <Stagger className={gridClasses(grid)}>
        {items.map((item, index) => {
          const image = item.mediaId ? images[item.mediaId] : undefined;
          const marker = content.numbered ? (
            <IndexNumber value={index + 1} tone="red" />
          ) : image ? (
            <Image
              src={image.url}
              alt={item.alt ?? image.alt ?? ""}
              width={image.width ?? 40}
              height={image.height ?? 40}
              sizes="40px"
              className="size-10 object-contain"
            />
          ) : item.icon ? (
            <span className="inline-flex size-10 items-center justify-center rounded-md bg-red-50 text-brand-red-text">
              <BlockIcon name={item.icon} size={20} />
            </span>
          ) : null;

          return (
            <StaggerItem key={`${index}-${item.title}`}>
              <div
                className={cn(
                  "h-full rounded-lg p-5",
                  CARD_SURFACE[content.cardStyle],
                  sideways && "flex gap-4",
                )}
              >
                {marker ? <div className={sideways ? "shrink-0" : "mb-3.5"}>{marker}</div> : null}
                <div className="space-y-1.5">
                  {item.badge ? (
                    <span className="inline-flex rounded-full bg-brand-red px-2.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-white">
                      {item.badge}
                    </span>
                  ) : null}
                  <h3 className="font-display text-lg text-navy-800">{item.title}</h3>
                  {item.text ? <p className="text-ink-muted">{item.text}</p> : null}
                  {item.ctaLabel && item.ctaHref ? (
                    <div className="pt-2">
                      <CtaButton href={{ pathname: item.ctaHref }} variant="outline">
                        {item.ctaLabel}
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

/**
 * The three bands lifted out of the homepage.
 *
 * Markup unchanged from `app/(website)/page.tsx`, so the pages that already use
 * these section types render byte-for-byte what they did — they are simply
 * editable now, and can carry a background like any other block.
 */
export function PositioningBlock({
  content,
  images = {},
}: {
  content: BlockContent<"positioning">;
  images?: BlockImages;
}) {
  return (
    <Band band={content.band} images={images} defaults={PAD_BAND} className="border-b border-line">
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-5">
          <Reveal>
            {content.eyebrow ? <Eyebrow>{content.eyebrow}</Eyebrow> : null}
            <h2 className="mt-4 text-3xl text-navy-800">{content.heading}</h2>
          </Reveal>
        </div>
        <div className="lg:col-span-6 lg:col-start-7 lg:pt-9">
          <Reveal delay={0.1}>
            <div className="space-y-5">
              {content.paragraphs.map((paragraph) => (
                <p key={paragraph.slice(0, 32)} className="text-lg leading-relaxed text-ink-muted">
                  {paragraph}
                </p>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </Band>
  );
}

export function ProcessBlock({
  content,
  images = {},
}: {
  content: BlockContent<"process">;
  images?: BlockImages;
}) {
  return (
    <Band
      band={content.band}
      images={images}
      defaults={PAD_BAND}
      className="border-b border-line bg-surface-muted"
    >
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-4">
          <Reveal>
            {content.eyebrow ? <Eyebrow>{content.eyebrow}</Eyebrow> : null}
            <h2 className="mt-4 text-3xl text-navy-800">{content.heading}</h2>
          </Reveal>
        </div>

        <div className="lg:col-span-7 lg:col-start-6">
          <Stagger>
            {content.steps.map((step, index) => (
              <StaggerItem key={step.title}>
                <div className="grid gap-3 border-t border-line-strong py-6 sm:grid-cols-[auto_1fr] sm:gap-6">
                  <IndexNumber value={index + 1} tone="red" className="sm:pt-1.5" />
                  <div>
                    <h3 className="font-display text-lg text-navy-800">{step.title}</h3>
                    <p className="mt-1.5 text-ink-muted">{step.text}</p>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </div>
    </Band>
  );
}

export function IndustriesBlock({
  content,
  images = {},
}: {
  content: BlockContent<"industries">;
  images?: BlockImages;
}) {
  return (
    <Band
      band={content.band}
      images={images}
      defaults={PAD_BAND_SHORT}
      className="border-b border-line"
    >
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Reveal>
            {content.eyebrow ? <Eyebrow>{content.eyebrow}</Eyebrow> : null}
            <h2 className="mt-4 text-2xl text-navy-800">{content.heading}</h2>
            {content.body ? <p className="mt-4 max-w-md text-ink-muted">{content.body}</p> : null}
          </Reveal>
        </div>
        <div className="lg:col-span-6 lg:col-start-7">
          <Reveal delay={0.08}>
            <ul className="flex flex-wrap gap-2">
              {content.items.map((item) => (
                <li
                  key={item}
                  className="rounded-sm border border-line-strong px-3 py-1.5 text-sm text-navy-700"
                >
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </Band>
  );
}
