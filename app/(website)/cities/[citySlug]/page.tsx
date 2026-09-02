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
import { localBusinessSchema } from "@/lib/seo/schema";

export const dynamic = "force-dynamic";

async function getCity(slug: string) {
  return db.city.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      slug: true,
      name: true,
      state: true,
      country: true,
      latitude: true,
      longitude: true,
      seo: { select: seoSelect },
      servicePages: {
        where: { status: "PUBLISHED" },
        orderBy: { service: { order: "asc" } },
        select: {
          id: true,
          localIntro: true,
          service: { select: { slug: true, name: true, shortDescription: true } },
        },
      },
      caseStudies: {
        where: { status: "PUBLISHED" },
        take: 2,
        select: {
          id: true,
          slug: true,
          title: true,
          clientName: true,
          metrics: { orderBy: { order: "asc" }, take: 1, select: { label: true, value: true, unit: true } },
        },
      },
      testimonials: {
        where: { status: "PUBLISHED" },
        take: 1,
        orderBy: { order: "asc" },
        select: { id: true, quote: true, authorName: true, authorRole: true, company: true },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ citySlug: string }>;
}): Promise<Metadata> {
  const { citySlug } = await params;
  const city = await getCity(citySlug);
  if (!city || city.servicePages.length === 0) return privateMetadata("Not found");

  return buildMetadata({
    path: `/cities/${city.slug}`,
    seo: city.seo,
    fallback: {
      title: `Digital marketing in ${city.name}`,
      description: `Our work in ${city.name}, ${city.state} — ${city.servicePages
        .map((p) => p.service.name)
        .join(", ")}.`,
    },
  });
}

export default async function CityPage({ params }: { params: Promise<{ citySlug: string }> }) {
  const { citySlug } = await params;
  const city = await getCity(citySlug);

  // A city with no published local pages is not a page — it would be a thin
  // directory entry, which is what CLAUDE.md 9 forbids.
  if (!city || city.servicePages.length === 0) notFound();

  const schema = await localBusinessSchema({
    name: city.name,
    state: city.state,
    country: city.country,
    latitude: city.latitude,
    longitude: city.longitude,
    path: `/cities/${city.slug}`,
  });

  const nearby = await db.city.findMany({
    where: {
      isActive: true,
      id: { not: city.id },
      state: city.state,
      servicePages: { some: { status: "PUBLISHED" } },
    },
    take: 4,
    orderBy: { order: "asc" },
    select: { id: true, slug: true, name: true },
  });

  return (
    <>
      <JsonLd schema={schema} />

      <section className="bg-navy-800 text-white">
        <Container className="pt-10 pb-12 lg:pt-14 lg:pb-16">
          <HeroReveal>
            <Breadcrumbs
              tone="light"
              crumbs={[
                { name: "Home", path: "/" },
                { name: "Locations", path: "/cities" },
                { name: city.name, path: `/cities/${city.slug}` },
              ]}
            />
            <p className="mt-8 text-2xs font-semibold uppercase tracking-widest text-brand-red">
              {city.state}
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl">Digital marketing in {city.name}</h1>
            <p className="mt-6 max-w-2xl text-lg text-navy-100">
              {city.servicePages.length}{" "}
              {city.servicePages.length === 1 ? "service" : "services"} with local work published
              for {city.name}.
            </p>
          </HeroReveal>
        </Container>
      </section>

      <section className="border-b border-line">
        <Container className="py-14 lg:py-18">
          <Reveal>
            <Eyebrow>Services here</Eyebrow>
          </Reveal>
          <Stagger className="mt-8 border-t border-line">
            {city.servicePages.map((page, index) => (
              <StaggerItem key={page.id}>
                <Link
                  href={`/services/${page.service.slug}/${city.slug}`}
                  className="group grid gap-2 border-b border-line py-6 transition-colors hover:bg-surface-muted lg:grid-cols-12 lg:gap-6 lg:px-2"
                >
                  <div className="flex items-baseline gap-4 lg:col-span-5">
                    <IndexNumber value={index + 1} />
                    <h2 className="font-display text-xl text-navy-800 transition-colors group-hover:text-brand-red">
                      {page.service.name} in {city.name}
                    </h2>
                  </div>
                  <p className="text-ink-muted lg:col-span-7">{page.service.shortDescription}</p>
                </Link>
              </StaggerItem>
            ))}
          </Stagger>
        </Container>
      </section>

      {city.caseStudies.length > 0 ? (
        <section className="border-b border-line bg-surface-muted">
          <Container className="py-14">
            <Reveal>
              <Eyebrow>Local proof</Eyebrow>
              <h2 className="mt-4 text-2xl text-navy-800">Work delivered in {city.name}</h2>
            </Reveal>
            <div className="mt-8 grid gap-px bg-line sm:grid-cols-2">
              {city.caseStudies.map((study) => (
                <Link
                  key={study.id}
                  href={`/case-studies/${study.slug}`}
                  className="group bg-white p-6 transition-colors hover:bg-surface-muted"
                >
                  <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                    {study.clientName}
                  </p>
                  <h3 className="mt-2.5 font-display text-lg text-navy-800 group-hover:text-brand-red">
                    {study.title}
                  </h3>
                  {study.metrics[0] ? (
                    <p className="mt-4 font-display text-xl tabular-nums text-navy-800">
                      {study.metrics[0].value}
                      <span className="text-brand-red">{study.metrics[0].unit}</span>
                      <span className="ml-2 align-middle text-xs font-normal text-ink-subtle">
                        {study.metrics[0].label}
                      </span>
                    </p>
                  ) : null}
                </Link>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      {city.testimonials[0] ? (
        <section className="border-b border-line">
          <Container width="narrow" className="py-14">
            <Reveal>
              <figure>
                <blockquote className="font-display text-2xl leading-snug text-navy-800">
                  &ldquo;{city.testimonials[0].quote}&rdquo;
                </blockquote>
                <figcaption className="mt-6 border-t border-line pt-4 text-sm">
                  <span className="font-medium text-navy-800">{city.testimonials[0].authorName}</span>
                  <span className="text-ink-subtle">
                    {city.testimonials[0].authorRole ? ` · ${city.testimonials[0].authorRole}` : ""}
                    {city.testimonials[0].company ? `, ${city.testimonials[0].company}` : ""}
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          </Container>
        </section>
      ) : null}

      {nearby.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-12">
            <h2 className="text-xl text-navy-800">Also in {city.state}</h2>
            <ul className="mt-5 flex flex-wrap gap-2">
              {nearby.map((other) => (
                <li key={other.id}>
                  <Link
                    href={`/cities/${other.slug}`}
                    className="inline-flex rounded-sm border border-line-strong px-3 py-1.5 text-sm text-navy-700 transition-colors hover:border-brand-red hover:text-brand-red"
                  >
                    {other.name}
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      ) : null}

      <section>
        <Container className="py-14">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <h2 className="text-3xl text-navy-800">Working in {city.name}?</h2>
              <p className="mt-4 max-w-xl text-ink-muted">
                Tell us what you are trying to move and we will tell you honestly whether we can
                help.
              </p>
            </div>
            <div className="lg:col-span-4 lg:col-start-9 lg:text-right">
              <CtaButton href="/contact" size="lg">
                Start a conversation
              </CtaButton>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
