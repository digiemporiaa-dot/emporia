import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Container, CtaButton, Eyebrow } from "@/components/website/primitives";
import { Breadcrumbs } from "@/components/website/breadcrumbs";
import { buildMetadata, privateMetadata } from "@/lib/seo/metadata";
import { seoSelect } from "@/lib/seo/select";
import { HeroReveal, Reveal } from "@/components/website/motion";
import { parseBody, caseBodySchema } from "@/lib/content/entity-body";

export const revalidate = 3600;

async function getStudy(slug: string) {
  return db.caseStudy.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: {
      id: true,
      slug: true,
      title: true,
      clientName: true,
      summary: true,
      body: true,
      seo: { select: seoSelect },
      service: { select: { slug: true, name: true } },
      city: { select: { slug: true, name: true } },
      metrics: { orderBy: { order: "asc" }, select: { id: true, label: true, value: true, unit: true } },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const study = await getStudy(slug);
  if (!study) return privateMetadata("Not found");

  return buildMetadata({
    path: `/case-studies/${study.slug}`,
    seo: study.seo,
    fallback: { title: study.title, description: study.summary },
  });
}

export default async function CaseStudyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const study = await getStudy(slug);
  if (!study) notFound();

  const body = parseBody(caseBodySchema, study.body);

  // Related work is derived from the relationship, not hand-picked.
  const related = await db.caseStudy.findMany({
    where: {
      status: "PUBLISHED",
      id: { not: study.id },
      ...(study.service ? { service: { slug: study.service.slug } } : {}),
    },
    take: 2,
    select: { id: true, slug: true, title: true, clientName: true },
  });

  const sections = [
    { label: "The challenge", text: body.challenge },
    { label: "What we did", text: body.approach },
    { label: "The outcome", text: body.outcome },
  ].filter((s): s is { label: string; text: string } => Boolean(s.text));

  return (
    <>
      <section className="bg-navy-800 text-white">
        <Container className="pt-10 pb-12 lg:pt-14 lg:pb-16">
          <HeroReveal>
            <Breadcrumbs
              tone="light"
              crumbs={[
                { name: "Home", path: "/" },
                { name: "Work", path: "/case-studies" },
                { name: study.clientName, path: `/case-studies/${study.slug}` },
              ]}
            />

            <p className="mt-8 text-2xs font-semibold uppercase tracking-widest text-brand-red-text">
              {study.clientName}
              {study.service ? ` · ${study.service.name}` : ""}
              {study.city ? ` · ${study.city.name}` : ""}
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl">{study.title}</h1>
            <p className="mt-6 max-w-2xl text-lg text-navy-100">{study.summary}</p>
          </HeroReveal>

          {study.metrics.length > 0 ? (
            <HeroReveal delay={0.15}>
              <dl className="mt-12 grid grid-cols-2 gap-px overflow-hidden bg-navy-700 lg:grid-cols-4">
                {study.metrics.map((metric) => (
                  <div key={metric.id} className="bg-navy-800 px-1 py-5 lg:px-5">
                    <dd className="font-display text-3xl tabular-nums text-white">
                      {metric.value}
                      <span className="text-brand-red">{metric.unit}</span>
                    </dd>
                    <dt className="mt-1.5 text-xs text-navy-300">{metric.label}</dt>
                  </div>
                ))}
              </dl>
            </HeroReveal>
          ) : null}
        </Container>
      </section>

      {sections.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-14 lg:py-20">
            <div className="space-y-12">
              {sections.map((section) => (
                <Reveal key={section.label}>
                  <div className="grid gap-4 lg:grid-cols-12 lg:gap-10">
                    <div className="lg:col-span-3">
                      <Eyebrow>{section.label}</Eyebrow>
                    </div>
                    <p className="max-w-2xl text-lg leading-relaxed text-navy-800 lg:col-span-8">
                      {section.text}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      {related.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-12">
            <h2 className="text-xl text-navy-800">More {study.service?.name ?? "work"}</h2>
            <div className="mt-6 grid gap-px bg-line sm:grid-cols-2">
              {related.map((item) => (
                <Link
                  key={item.id}
                  href={`/case-studies/${item.slug}`}
                  className="group bg-white p-6 transition-colors hover:bg-surface-muted"
                >
                  <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                    {item.clientName}
                  </p>
                  <h3 className="mt-2 font-display text-lg text-navy-800 group-hover:text-brand-red">
                    {item.title}
                  </h3>
                </Link>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      <section>
        <Container className="py-14">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <h2 className="text-3xl text-navy-800">Want results like these?</h2>
              <p className="mt-4 max-w-xl text-ink-muted">
                Tell us the number you need to move and we will tell you honestly whether we can
                move it.
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
