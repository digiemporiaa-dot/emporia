import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  publishedCaseStudies,
  publishedPackages,
  publishedPageSections,
  publishedPosts,
  publishedServices,
  publishedTestimonials,
} from "@/lib/content/queries";
import { findSection } from "@/lib/content/sections";
import { formatMoney } from "@/lib/money";
import { ArrowLink, Container, CtaButton, Eyebrow, IndexNumber } from "@/components/website/primitives";
import { HeroReveal, Reveal, Stagger, StaggerItem } from "@/components/website/motion";
import { Counter } from "@/components/website/counter";

/**
 * Homepage.
 *
 * Editorial copy comes from the `home` CMS page and its sections; everything
 * else — services, results, work, packages, testimonials, insights — is read
 * from the entities themselves, so the homepage cannot advertise something that
 * is not published.
 *
 * ISR with on-demand revalidation rather than generateStaticParams, so the
 * container build stays hermetic (docs/ARCHITECTURE.md 17.2).
 */
/**
 * Rendered at request time, with the underlying data cached and tagged.
 * A static route that reads the database would be prerendered at build,
 * forcing the container build to carry database credentials
 * (docs/ARCHITECTURE.md 17.2).
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const page = await publishedPageSections("home");
  return {
    title: page?.seo?.metaTitle ?? "Emporia",
    description: page?.seo?.metaDescription ?? undefined,
  };
}

/** Splits a metric like "+312" / "2.4" into a number to count and its affixes. */
function splitMetric(value: string): { prefix: string; number: number | null; decimals: number } {
  const match = /^([+-]?)(\d+(?:\.(\d+))?)$/.exec(value.trim());
  if (!match) return { prefix: "", number: null, decimals: 0 };
  return {
    prefix: match[1] ?? "",
    number: Number(match[2]),
    decimals: match[3]?.length ?? 0,
  };
}

export default async function HomePage() {
  const page = await publishedPageSections("home");
  if (!page) notFound();

  const [services, caseStudies, packages, testimonials, posts] = await Promise.all([
    publishedServices(),
    publishedCaseStudies(3),
    publishedPackages(),
    publishedTestimonials(2),
    publishedPosts(3),
  ]);

  const hero = findSection(page.sections, "hero");
  const positioning = findSection(page.sections, "positioning");
  const process = findSection(page.sections, "process");
  const industries = findSection(page.sections, "industries");
  const cta = findSection(page.sections, "cta");

  const [featured, ...secondary] = caseStudies;
  const headlineMetrics = caseStudies.flatMap((study) =>
    study.metrics.slice(0, 1).map((metric) => ({ ...metric, client: study.clientName })),
  );

  return (
    <>
      {/* ── Hero: type-led and asymmetric, not a centred banner ───────────── */}
      {hero ? (
        <section className="border-b border-line">
          <Container className="pt-14 pb-12 lg:pt-24 lg:pb-16">
            <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
              <div className="lg:col-span-8">
                {hero.eyebrow ? (
                  <HeroReveal>
                    <Eyebrow>{hero.eyebrow}</Eyebrow>
                  </HeroReveal>
                ) : null}
                <HeroReveal delay={0.08}>
                  <h1 className="mt-4 max-w-4xl text-5xl text-navy-800">{hero.heading}</h1>
                </HeroReveal>
              </div>

              <div className="lg:col-span-4 lg:pt-16">
                <HeroReveal delay={0.16}>
                  {hero.body ? (
                    <p className="max-w-md text-lg leading-relaxed text-ink-muted">{hero.body}</p>
                  ) : null}
                  <div className="mt-7 flex flex-wrap gap-3">
                    {hero.ctaLabel && hero.ctaHref ? (
                      <CtaButton href={{ pathname: hero.ctaHref }} size="lg">
                        {hero.ctaLabel}
                      </CtaButton>
                    ) : null}
                    {hero.secondaryLabel && hero.secondaryHref ? (
                      <CtaButton href={{ pathname: hero.secondaryHref }} variant="outline" size="lg">
                        {hero.secondaryLabel}
                      </CtaButton>
                    ) : null}
                  </div>
                </HeroReveal>
              </div>
            </div>

            {hero.facts && hero.facts.length > 0 ? (
              <HeroReveal delay={0.28}>
                <dl className="mt-14 grid grid-cols-2 gap-px overflow-hidden border-t border-line bg-line lg:grid-cols-4">
                  {hero.facts.map((fact) => (
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
          </Container>
        </section>
      ) : null}

      {/* ── Trust: a quiet strip of real client names ─────────────────────── */}
      {caseStudies.length > 0 ? (
        <section className="border-b border-line bg-surface-muted py-6">
          <Container>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
              <p className="shrink-0 text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                Selected clients
              </p>
              <ul className="flex flex-wrap items-center gap-x-8 gap-y-2">
                {caseStudies.map((study) => (
                  <li key={study.id} className="font-display text-sm text-navy-700">
                    {study.clientName}
                  </li>
                ))}
              </ul>
            </div>
          </Container>
        </section>
      ) : null}

      {/* ── Positioning: split, with the statement carrying the weight ────── */}
      {positioning ? (
        <section className="border-b border-line">
          <Container className="py-16 lg:py-24">
            <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
              <div className="lg:col-span-5">
                <Reveal>
                  {positioning.eyebrow ? <Eyebrow>{positioning.eyebrow}</Eyebrow> : null}
                  <h2 className="mt-4 text-3xl text-navy-800">{positioning.heading}</h2>
                </Reveal>
              </div>
              <div className="lg:col-span-6 lg:col-start-7 lg:pt-9">
                <Reveal delay={0.1}>
                  <div className="space-y-5">
                    {positioning.paragraphs.map((paragraph) => (
                      <p key={paragraph.slice(0, 32)} className="text-lg leading-relaxed text-ink-muted">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </Reveal>
              </div>
            </div>
          </Container>
        </section>
      ) : null}

      {/* ── Services: an editorial index, not a grid of identical cards ───── */}
      {services.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-16 lg:py-24">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <Reveal>
                <Eyebrow>Services</Eyebrow>
                <h2 className="mt-4 max-w-xl text-3xl text-navy-800">
                  Six disciplines, run as one programme.
                </h2>
              </Reveal>
              <Reveal delay={0.1}>
                <ArrowLink href="/services">All services</ArrowLink>
              </Reveal>
            </div>

            <Stagger className="mt-12 border-t border-line">
              {services.map((service, index) => (
                <StaggerItem key={service.id}>
                  <Link
                    href={{ pathname: "/services/[serviceSlug]", query: { serviceSlug: service.slug } }}
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
          </Container>
        </section>
      ) : null}

      {/* ── Results: dark band, real numbers from case study metrics ──────── */}
      {headlineMetrics.length > 0 ? (
        <section className="bg-navy-800 text-white">
          <Container className="py-16 lg:py-24">
            <Reveal>
              <Eyebrow tone="light">Results</Eyebrow>
              <h2 className="mt-4 max-w-2xl text-3xl">
                Numbers from live engagements, not projections.
              </h2>
            </Reveal>

            <dl className="mt-12 grid gap-px overflow-hidden bg-navy-700 sm:grid-cols-3">
              {headlineMetrics.map((metric) => {
                const parsed = splitMetric(metric.value);
                return (
                  <div key={`${metric.client}-${metric.label}`} className="bg-navy-800 px-1 py-6 sm:px-6">
                    <dd className="font-display text-5xl tabular-nums text-white">
                      {parsed.prefix}
                      {parsed.number === null ? (
                        metric.value
                      ) : (
                        <Counter value={parsed.number} decimals={parsed.decimals} />
                      )}
                      <span className="text-brand-red">{metric.unit}</span>
                    </dd>
                    <dt className="mt-3 text-sm text-navy-100">{metric.label}</dt>
                    <p className="mt-1 text-xs text-navy-300">{metric.client}</p>
                  </div>
                );
              })}
            </dl>
          </Container>
        </section>
      ) : null}

      {/* ── Featured work: one large, the rest offset beneath ─────────────── */}
      {featured ? (
        <section className="border-b border-line">
          <Container className="py-16 lg:py-24">
            <Reveal>
              <Eyebrow>Selected work</Eyebrow>
            </Reveal>

            <Reveal delay={0.06}>
              <Link
                href={{ pathname: "/case-studies/[slug]", query: { slug: featured.slug } }}
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
                      href={{ pathname: "/case-studies/[slug]", query: { slug: study.slug } }}
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

            <div className="mt-10">
              <ArrowLink href="/case-studies">All case studies</ArrowLink>
            </div>
          </Container>
        </section>
      ) : null}

      {/* ── Process: numbered sequence on hairlines ───────────────────────── */}
      {process ? (
        <section className="border-b border-line bg-surface-muted">
          <Container className="py-16 lg:py-24">
            <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
              <div className="lg:col-span-4">
                <Reveal>
                  {process.eyebrow ? <Eyebrow>{process.eyebrow}</Eyebrow> : null}
                  <h2 className="mt-4 text-3xl text-navy-800">{process.heading}</h2>
                </Reveal>
              </div>

              <div className="lg:col-span-7 lg:col-start-6">
                <Stagger>
                  {process.steps.map((step, index) => (
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
          </Container>
        </section>
      ) : null}

      {/* ── Industries: dense wrap, deliberately a different rhythm ───────── */}
      {industries ? (
        <section className="border-b border-line">
          <Container className="py-16 lg:py-20">
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="lg:col-span-5">
                <Reveal>
                  {industries.eyebrow ? <Eyebrow>{industries.eyebrow}</Eyebrow> : null}
                  <h2 className="mt-4 text-2xl text-navy-800">{industries.heading}</h2>
                  {industries.body ? (
                    <p className="mt-4 max-w-md text-ink-muted">{industries.body}</p>
                  ) : null}
                </Reveal>
              </div>
              <div className="lg:col-span-6 lg:col-start-7">
                <Reveal delay={0.08}>
                  <ul className="flex flex-wrap gap-2">
                    {industries.items.map((item) => (
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
          </Container>
        </section>
      ) : null}

      {/* ── Packages: real Decimal prices from the database ───────────────── */}
      {packages.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-16 lg:py-24">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <Reveal>
                <Eyebrow>Packages</Eyebrow>
                <h2 className="mt-4 max-w-xl text-3xl text-navy-800">
                  Indicative starting points, not a menu.
                </h2>
              </Reveal>
              <Reveal delay={0.1}>
                <ArrowLink href="/packages">Compare packages</ArrowLink>
              </Reveal>
            </div>

            <Stagger className="mt-12 grid gap-px bg-line lg:grid-cols-3">
              {packages.map((pkg) => (
                <StaggerItem key={pkg.id} className="min-w-0 bg-white">
                  <Link
                    href={{ pathname: "/packages/[packageSlug]", query: { packageSlug: pkg.slug } }}
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
                    {pkg.tagline ? (
                      <p className="mt-2.5 text-sm text-ink-muted">{pkg.tagline}</p>
                    ) : null}
                    <p className="mt-6 font-display text-3xl tabular-nums text-navy-800">
                      {formatMoney(pkg.price, pkg.currency)}
                    </p>
                    <p className="mt-1 text-xs text-ink-subtle">
                      {pkg.billingType === "RETAINER" ? "per month, retainer" : "per month"} · excl. tax
                    </p>
                    <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-red">
                      What is included
                      <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">
                        →
                      </span>
                    </span>
                  </Link>
                </StaggerItem>
              ))}
            </Stagger>
          </Container>
        </section>
      ) : null}

      {/* ── Testimonials: pull quotes at scale, not cards ─────────────────── */}
      {testimonials.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-16 lg:py-24">
            <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
              {testimonials.map((testimonial, index) => (
                <Reveal key={testimonial.id} delay={index * 0.08}>
                  <figure className={index === 1 ? "lg:pt-16" : undefined}>
                    <span aria-hidden="true" className="font-display text-4xl leading-none text-brand-red">
                      &ldquo;
                    </span>
                    <blockquote className="mt-3 font-display text-2xl leading-snug text-navy-800">
                      {testimonial.quote}
                    </blockquote>
                    <figcaption className="mt-6 border-t border-line pt-4 text-sm">
                      <span className="font-medium text-navy-800">{testimonial.authorName}</span>
                      <span className="text-ink-subtle">
                        {testimonial.authorRole ? ` · ${testimonial.authorRole}` : ""}
                        {testimonial.company ? `, ${testimonial.company}` : ""}
                      </span>
                    </figcaption>
                  </figure>
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      {/* ── Insights ──────────────────────────────────────────────────────── */}
      {posts.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-16 lg:py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <Reveal>
                <Eyebrow>Insights</Eyebrow>
                <h2 className="mt-4 text-2xl text-navy-800">What we are working out.</h2>
              </Reveal>
              <Reveal delay={0.1}>
                <ArrowLink href="/blog">All insights</ArrowLink>
              </Reveal>
            </div>

            <Stagger className="mt-10 border-t border-line">
              {posts.map((post) => (
                <StaggerItem key={post.id}>
                  <Link
                    href={{ pathname: "/blog/[slug]", query: { slug: post.slug } }}
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
          </Container>
        </section>
      ) : null}

      {/* ── Final CTA ─────────────────────────────────────────────────────── */}
      {cta ? (
        <section className="bg-navy-800 text-white">
          <Container className="py-16 lg:py-24">
            <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
              <div className="lg:col-span-7">
                <Reveal>
                  <h2 className="max-w-2xl text-4xl">{cta.heading}</h2>
                  {cta.body ? (
                    <p className="mt-5 max-w-xl text-lg text-navy-100">{cta.body}</p>
                  ) : null}
                </Reveal>
              </div>
              <div className="lg:col-span-4 lg:col-start-9 lg:text-right">
                <Reveal delay={0.1}>
                  <CtaButton href={{ pathname: cta.ctaHref }} size="lg">
                    {cta.ctaLabel}
                  </CtaButton>
                </Reveal>
              </div>
            </div>
          </Container>
        </section>
      ) : null}
    </>
  );
}
