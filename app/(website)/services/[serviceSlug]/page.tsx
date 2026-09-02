import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { ArrowLink, Container, CtaButton, Eyebrow, IndexNumber } from "@/components/website/primitives";
import { Breadcrumbs } from "@/components/website/breadcrumbs";
import { JsonLd } from "@/components/website/json-ld";
import { buildMetadata, privateMetadata } from "@/lib/seo/metadata";
import { seoSelect } from "@/lib/seo/select";
import { faqSchema, serviceSchema } from "@/lib/seo/schema";
import { HeroReveal, Reveal, Stagger, StaggerItem } from "@/components/website/motion";

export const revalidate = 3600;

/** Service body is JSON, so it is validated before render, not trusted. */
const serviceBody = z.object({
  intro: z.string().optional(),
  deliverables: z.array(z.string()).optional(),
  approach: z.string().optional(),
});

async function getService(slug: string) {
  return db.service.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: {
      id: true,
      slug: true,
      name: true,
      shortDescription: true,
      body: true,
      seo: { select: seoSelect },
      faqs: {
        where: { isActive: true },
        orderBy: { order: "asc" },
        select: { id: true, question: true, answer: true },
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
      packages: {
        where: { status: "PUBLISHED" },
        orderBy: { order: "asc" },
        select: { id: true, slug: true, name: true, price: true, currency: true, tagline: true },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ serviceSlug: string }>;
}): Promise<Metadata> {
  const { serviceSlug } = await params;
  const service = await getService(serviceSlug);
  if (!service) return privateMetadata("Not found");

  return buildMetadata({
    path: `/services/${service.slug}`,
    seo: service.seo,
    fallback: {
      title: `${service.name} services`,
      description: service.shortDescription,
    },
  });
}

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ serviceSlug: string }>;
}) {
  const { serviceSlug } = await params;
  const service = await getService(serviceSlug);
  if (!service) notFound();

  const parsedBody = serviceBody.safeParse(service.body);
  const body = parsedBody.success ? parsedBody.data : {};

  // Contextual internal links, derived from relationships rather than a dump.
  // FAQPage is emitted only when the page actually renders questions.
  const schema = [
    await serviceSchema({
      name: service.name,
      description: service.shortDescription,
      path: `/services/${service.slug}`,
    }),
    faqSchema(service.faqs),
  ];

  const relatedServices = await db.service.findMany({
    where: { status: "PUBLISHED", id: { not: service.id } },
    orderBy: { order: "asc" },
    take: 4,
    select: { id: true, slug: true, name: true, shortDescription: true },
  });

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
                { name: service.name, path: `/services/${service.slug}` },
              ]}
            />

            <div className="mt-8 grid gap-8 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <h1 className="text-4xl text-navy-800">{service.name}</h1>
                <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-muted">
                  {service.shortDescription}
                </p>
              </div>
              <div className="lg:col-span-4 lg:col-start-9 lg:pt-3">
                <CtaButton href="/contact" size="lg">
                  Discuss {service.name.toLowerCase()}
                </CtaButton>
              </div>
            </div>
          </HeroReveal>
        </Container>
      </section>

      {body.intro || body.deliverables ? (
        <section className="border-b border-line">
          <Container className="py-14 lg:py-20">
            <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
              <div className="lg:col-span-5">
                {body.intro ? (
                  <Reveal>
                    <Eyebrow>The approach</Eyebrow>
                    <p className="mt-4 text-xl leading-relaxed text-navy-800">{body.intro}</p>
                    {body.approach ? (
                      <p className="mt-5 text-ink-muted">{body.approach}</p>
                    ) : null}
                  </Reveal>
                ) : null}
              </div>

              {body.deliverables && body.deliverables.length > 0 ? (
                <div className="lg:col-span-6 lg:col-start-7">
                  <Reveal delay={0.08}>
                    <Eyebrow tone="muted">What is included</Eyebrow>
                  </Reveal>
                  <Stagger className="mt-5 border-t border-line">
                    {body.deliverables.map((item, index) => (
                      <StaggerItem key={item}>
                        <div className="flex items-baseline gap-4 border-b border-line py-3.5">
                          <IndexNumber value={index + 1} />
                          <p className="text-navy-800">{item}</p>
                        </div>
                      </StaggerItem>
                    ))}
                  </Stagger>
                </div>
              ) : null}
            </div>
          </Container>
        </section>
      ) : null}

      {service.caseStudies.length > 0 ? (
        <section className="border-b border-line bg-surface-muted">
          <Container className="py-14 lg:py-20">
            <Reveal>
              <Eyebrow>Proof</Eyebrow>
              <h2 className="mt-4 text-2xl text-navy-800">
                {service.name} work we can point at.
              </h2>
            </Reveal>

            <Stagger className="mt-8 grid gap-px bg-line sm:grid-cols-2">
              {service.caseStudies.map((study) => (
                <StaggerItem key={study.id} className="bg-white">
                  <Link
                    href={`/case-studies/${study.slug}`}
                    className="group flex h-full flex-col p-6 transition-colors hover:bg-surface-muted"
                  >
                    <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                      {study.clientName}
                    </p>
                    <h3 className="mt-2.5 font-display text-lg text-navy-800 group-hover:text-brand-red">
                      {study.title}
                    </h3>
                    {study.metrics[0] ? (
                      <p className="mt-5 font-display text-2xl tabular-nums text-navy-800">
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
          </Container>
        </section>
      ) : null}

      {service.testimonials[0] ? (
        <section className="border-b border-line">
          <Container className="py-14 lg:py-20" width="narrow">
            <Reveal>
              <figure>
                <blockquote className="font-display text-2xl leading-snug text-navy-800">
                  &ldquo;{service.testimonials[0].quote}&rdquo;
                </blockquote>
                <figcaption className="mt-6 border-t border-line pt-4 text-sm">
                  <span className="font-medium text-navy-800">
                    {service.testimonials[0].authorName}
                  </span>
                  <span className="text-ink-subtle">
                    {service.testimonials[0].authorRole ? ` · ${service.testimonials[0].authorRole}` : ""}
                    {service.testimonials[0].company ? `, ${service.testimonials[0].company}` : ""}
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          </Container>
        </section>
      ) : null}

      {service.faqs.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-14 lg:py-20">
            <div className="grid gap-10 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <Reveal>
                  <Eyebrow>Questions</Eyebrow>
                  <h2 className="mt-4 text-2xl text-navy-800">
                    What clients ask before starting.
                  </h2>
                </Reveal>
              </div>
              <div className="lg:col-span-7 lg:col-start-6">
                <dl className="border-t border-line">
                  {service.faqs.map((faq) => (
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

      {service.packages.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-14 lg:py-18">
            <Reveal>
              <Eyebrow>Packages</Eyebrow>
              <h2 className="mt-4 text-2xl text-navy-800">Starting points for {service.name.toLowerCase()}.</h2>
            </Reveal>
            <div className="mt-8 grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
              {service.packages.map((pkg) => (
                <Link
                  key={pkg.id}
                  href={`/packages/${pkg.slug}`}
                  className="group bg-white p-6 transition-colors hover:bg-surface-muted"
                >
                  <h3 className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                    {pkg.name}
                  </h3>
                  {pkg.tagline ? <p className="mt-2 text-sm text-ink-muted">{pkg.tagline}</p> : null}
                  <p className="mt-4 font-display text-2xl tabular-nums text-navy-800">
                    {formatMoney(pkg.price.toString(), pkg.currency)}
                  </p>
                </Link>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      {relatedServices.length > 0 ? (
        <section>
          <Container className="py-14 lg:py-18">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="text-2xl text-navy-800">Works well alongside</h2>
              <ArrowLink href="/services">All services</ArrowLink>
            </div>
            <ul className="mt-8 border-t border-line">
              {relatedServices.map((related, index) => (
                <li key={related.id}>
                  <Link
                    href={`/services/${related.slug}`}
                    className="group grid gap-1.5 border-b border-line py-4 transition-colors hover:bg-surface-muted lg:grid-cols-12 lg:items-baseline lg:gap-6 lg:px-2"
                  >
                    <div className="flex items-baseline gap-3 lg:col-span-4">
                      <IndexNumber value={index + 1} />
                      <span className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                        {related.name}
                      </span>
                    </div>
                    <span className="text-sm text-ink-muted lg:col-span-8">
                      {related.shortDescription}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      ) : null}
    </>
  );
}
