import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Container, CtaButton, Eyebrow, IndexNumber } from "@/components/website/primitives";
import { Breadcrumbs } from "@/components/website/breadcrumbs";
import { JsonLd } from "@/components/website/json-ld";
import { HeroReveal, Reveal, Stagger, StaggerItem } from "@/components/website/motion";
import { buildMetadata, privateMetadata } from "@/lib/seo/metadata";
import { seoSelect } from "@/lib/seo/select";
import { faqSchema, localBusinessSchema, serviceSchema } from "@/lib/seo/schema";

/**
 * Service × City.
 *
 * Generated from the database, never hand-written (CLAUDE.md 9). A page only
 * reaches this route if it is PUBLISHED, which `publishPage` gates on
 * `canPublish` — so a thin page cannot be reached or indexed.
 */
export const dynamic = "force-dynamic";

async function getPage(serviceSlug: string, citySlug: string) {
  return db.serviceCityPage.findFirst({
    where: {
      status: "PUBLISHED",
      service: { slug: serviceSlug, status: "PUBLISHED" },
      city: { slug: citySlug, isActive: true },
    },
    select: {
      id: true,
      localIntro: true,
      marketContext: true,
      industries: true,
      positioning: true,
      ctaHeading: true,
      ctaBody: true,
      seo: { select: seoSelect },
      service: {
        select: { id: true, slug: true, name: true, shortDescription: true },
      },
      city: {
        select: {
          id: true,
          slug: true,
          name: true,
          state: true,
          country: true,
          latitude: true,
          longitude: true,
        },
      },
      faqs: {
        where: { isActive: true },
        orderBy: { order: "asc" },
        select: { id: true, question: true, answer: true },
      },
    },
  });
}

function industriesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && !!v.trim()) : [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ serviceSlug: string; citySlug: string }>;
}): Promise<Metadata> {
  const { serviceSlug, citySlug } = await params;
  const page = await getPage(serviceSlug, citySlug);
  if (!page) return privateMetadata("Not found");

  return buildMetadata({
    path: `/services/${page.service.slug}/${page.city.slug}`,
    seo: page.seo,
    fallback: {
      title: `${page.service.name} in ${page.city.name}`,
      description: page.localIntro?.slice(0, 180) ?? page.service.shortDescription,
    },
  });
}

export default async function ServiceCityPage({
  params,
}: {
  params: Promise<{ serviceSlug: string; citySlug: string }>;
}) {
  const { serviceSlug, citySlug } = await params;
  const page = await getPage(serviceSlug, citySlug);
  if (!page) notFound();

  const industries = industriesOf(page.industries);

  const [localCaseStudies, localTestimonials, siblingCities, otherServices] = await Promise.all([
    db.caseStudy.findMany({
      where: { status: "PUBLISHED", cityId: page.city.id },
      take: 2,
      select: {
        id: true,
        slug: true,
        title: true,
        clientName: true,
        metrics: { orderBy: { order: "asc" }, take: 2, select: { label: true, value: true, unit: true } },
      },
    }),
    db.testimonial.findMany({
      where: { status: "PUBLISHED", cityId: page.city.id },
      take: 1,
      orderBy: { order: "asc" },
      select: { id: true, quote: true, authorName: true, authorRole: true, company: true },
    }),
    // Same service, other cities — contextual linking from the relationship.
    db.serviceCityPage.findMany({
      where: {
        status: "PUBLISHED",
        serviceId: page.service.id,
        cityId: { not: page.city.id },
        city: { isActive: true },
      },
      take: 5,
      select: { id: true, city: { select: { slug: true, name: true } } },
    }),
    // Other services in this city.
    db.serviceCityPage.findMany({
      where: {
        status: "PUBLISHED",
        cityId: page.city.id,
        serviceId: { not: page.service.id },
      },
      take: 5,
      select: { id: true, service: { select: { slug: true, name: true } } },
    }),
  ]);

  const schema = [
    await serviceSchema({
      name: `${page.service.name} in ${page.city.name}`,
      description: page.localIntro ?? page.service.shortDescription,
      path: `/services/${page.service.slug}/${page.city.slug}`,
    }),
    await localBusinessSchema({
      name: page.city.name,
      state: page.city.state,
      country: page.city.country,
      latitude: page.city.latitude,
      longitude: page.city.longitude,
      path: `/services/${page.service.slug}/${page.city.slug}`,
    }),
    faqSchema(page.faqs),
  ];

  return (
    <>
      <JsonLd schema={schema} />

      <section className="border-b border-line">
        <Container className="pt-10 pb-12 lg:pt-14 lg:pb-16">
          <HeroReveal>
            <Breadcrumbs
              crumbs={[
                { name: "Home", path: "/" },
                { name: "Services", path: "/services" },
                { name: page.service.name, path: `/services/${page.service.slug}` },
                {
                  name: page.city.name,
                  path: `/services/${page.service.slug}/${page.city.slug}`,
                },
              ]}
            />

            <div className="mt-8 grid gap-8 lg:grid-cols-12">
              <div className="lg:col-span-8">
                <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">
                  {page.city.name}, {page.city.state}
                </p>
                <h1 className="mt-4 text-4xl text-navy-800">
                  {page.service.name} in {page.city.name}
                </h1>
                {page.positioning ? (
                  <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-muted">
                    {page.positioning}
                  </p>
                ) : null}
              </div>
              <div className="lg:col-span-3 lg:col-start-10 lg:pt-12">
                <CtaButton href="/contact" size="lg">
                  Talk to us
                </CtaButton>
              </div>
            </div>
          </HeroReveal>
        </Container>
      </section>

      {page.localIntro ? (
        <section className="border-b border-line">
          <Container className="py-14 lg:py-18">
            <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
              <div className="lg:col-span-4">
                <Reveal>
                  <Eyebrow>The local picture</Eyebrow>
                </Reveal>
              </div>
              <div className="lg:col-span-7 lg:col-start-6">
                <Reveal delay={0.06}>
                  <p className="text-lg leading-relaxed text-navy-800">{page.localIntro}</p>
                </Reveal>
              </div>
            </div>
          </Container>
        </section>
      ) : null}

      {page.marketContext ? (
        <section className="border-b border-line bg-surface-muted">
          <Container className="py-14 lg:py-18">
            <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
              <div className="lg:col-span-4">
                <Reveal>
                  <Eyebrow>Market context</Eyebrow>
                  <h2 className="mt-4 text-2xl text-navy-800">
                    What is different about {page.city.name}
                  </h2>
                </Reveal>
              </div>
              <div className="lg:col-span-7 lg:col-start-6">
                <Reveal delay={0.06}>
                  <p className="leading-relaxed text-ink-muted">{page.marketContext}</p>
                </Reveal>
              </div>
            </div>
          </Container>
        </section>
      ) : null}

      {industries.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-12 lg:py-16">
            <div className="grid gap-6 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <Reveal>
                  <Eyebrow>Sectors here</Eyebrow>
                  <h2 className="mt-4 text-2xl text-navy-800">
                    Who we work with in {page.city.name}
                  </h2>
                </Reveal>
              </div>
              <div className="lg:col-span-7 lg:col-start-6">
                <Reveal delay={0.06}>
                  <ul className="flex flex-wrap gap-2">
                    {industries.map((industry) => (
                      <li
                        key={industry}
                        className="rounded-sm border border-line-strong px-3 py-1.5 text-sm text-navy-700"
                      >
                        {industry}
                      </li>
                    ))}
                  </ul>
                </Reveal>
              </div>
            </div>
          </Container>
        </section>
      ) : null}

      {localCaseStudies.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-14">
            <Reveal>
              <Eyebrow>Local proof</Eyebrow>
              <h2 className="mt-4 text-2xl text-navy-800">Results in {page.city.name}</h2>
            </Reveal>
            <div className="mt-8 grid gap-px bg-line sm:grid-cols-2">
              {localCaseStudies.map((study) => (
                <Link
                  key={study.id}
                  href={{ pathname: "/case-studies/[slug]", query: { slug: study.slug } }}
                  className="group bg-white p-6 transition-colors hover:bg-surface-muted"
                >
                  <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                    {study.clientName}
                  </p>
                  <h3 className="mt-2.5 font-display text-lg text-navy-800 group-hover:text-brand-red">
                    {study.title}
                  </h3>
                  <dl className="mt-4 flex gap-6">
                    {study.metrics.map((metric) => (
                      <div key={metric.label}>
                        <dd className="font-display text-xl tabular-nums text-navy-800">
                          {metric.value}
                          <span className="text-brand-red">{metric.unit}</span>
                        </dd>
                        <dt className="mt-0.5 text-xs text-ink-subtle">{metric.label}</dt>
                      </div>
                    ))}
                  </dl>
                </Link>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      {localTestimonials[0] ? (
        <section className="border-b border-line">
          <Container width="narrow" className="py-14">
            <Reveal>
              <figure>
                <blockquote className="font-display text-2xl leading-snug text-navy-800">
                  &ldquo;{localTestimonials[0].quote}&rdquo;
                </blockquote>
                <figcaption className="mt-6 border-t border-line pt-4 text-sm">
                  <span className="font-medium text-navy-800">
                    {localTestimonials[0].authorName}
                  </span>
                  <span className="text-ink-subtle">
                    {localTestimonials[0].authorRole ? ` · ${localTestimonials[0].authorRole}` : ""}
                    {localTestimonials[0].company ? `, ${localTestimonials[0].company}` : ""}
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          </Container>
        </section>
      ) : null}

      {page.faqs.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-14">
            <div className="grid gap-10 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <Reveal>
                  <Eyebrow>Local questions</Eyebrow>
                  <h2 className="mt-4 text-2xl text-navy-800">
                    Asked by {page.city.name} clients
                  </h2>
                </Reveal>
              </div>
              <div className="lg:col-span-7 lg:col-start-6">
                <dl className="border-t border-line">
                  {page.faqs.map((faq) => (
                    <div key={faq.id} className="border-b border-line py-5">
                      <dt className="font-display text-lg text-navy-800">{faq.question}</dt>
                      <dd className="mt-2 text-ink-muted">{faq.answer}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </Container>
        </section>
      ) : null}

      {siblingCities.length > 0 || otherServices.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-12">
            <div className="grid gap-10 sm:grid-cols-2">
              {siblingCities.length > 0 ? (
                <div>
                  <h2 className="text-lg text-navy-800">
                    {page.service.name} elsewhere
                  </h2>
                  <Stagger className="mt-4 border-t border-line">
                    {siblingCities.map((sibling, index) => (
                      <StaggerItem key={sibling.id}>
                        <Link
                          href={{
                            pathname: "/services/[serviceSlug]/[citySlug]",
                            query: { serviceSlug: page.service.slug, citySlug: sibling.city.slug },
                          }}
                          className="group flex items-baseline gap-3 border-b border-line py-3 text-sm"
                        >
                          <IndexNumber value={index + 1} />
                          <span className="text-navy-800 group-hover:text-brand-red">
                            {page.service.name} in {sibling.city.name}
                          </span>
                        </Link>
                      </StaggerItem>
                    ))}
                  </Stagger>
                </div>
              ) : null}

              {otherServices.length > 0 ? (
                <div>
                  <h2 className="text-lg text-navy-800">Other services in {page.city.name}</h2>
                  <Stagger className="mt-4 border-t border-line">
                    {otherServices.map((other, index) => (
                      <StaggerItem key={other.id}>
                        <Link
                          href={{
                            pathname: "/services/[serviceSlug]/[citySlug]",
                            query: { serviceSlug: other.service.slug, citySlug: page.city.slug },
                          }}
                          className="group flex items-baseline gap-3 border-b border-line py-3 text-sm"
                        >
                          <IndexNumber value={index + 1} />
                          <span className="text-navy-800 group-hover:text-brand-red">
                            {other.service.name} in {page.city.name}
                          </span>
                        </Link>
                      </StaggerItem>
                    ))}
                  </Stagger>
                </div>
              ) : null}
            </div>
          </Container>
        </section>
      ) : null}

      {page.ctaHeading ? (
        <section className="bg-navy-800 text-white">
          <Container className="py-14 lg:py-18">
            <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
              <div className="lg:col-span-7">
                <h2 className="text-3xl">{page.ctaHeading}</h2>
                {page.ctaBody ? (
                  <p className="mt-4 max-w-xl text-navy-100">{page.ctaBody}</p>
                ) : null}
              </div>
              <div className="lg:col-span-4 lg:col-start-9 lg:text-right">
                <CtaButton href="/contact" size="lg">
                  Start a conversation
                </CtaButton>
              </div>
            </div>
          </Container>
        </section>
      ) : null}
    </>
  );
}
