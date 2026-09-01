import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import Link from "next/link";
import { publishedCaseStudies } from "@/lib/content/queries";
import { Container, Eyebrow, IndexNumber } from "@/components/website/primitives";
import { HeroReveal, Stagger, StaggerItem } from "@/components/website/motion";

/**
 * Rendered at request time, with the underlying data cached and tagged.
 * A static route that reads the database would be prerendered at build,
 * forcing the container build to carry database credentials
 * (docs/ARCHITECTURE.md 17.2).
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/case-studies",
    fallback: {
      title: "Case studies",
      description:
        "Engagements we can show the numbers for, across SEO, paid media and local search.",
    },
  });
}

export default async function CaseStudiesPage() {
  const studies = await publishedCaseStudies();

  return (
    <>
      <section className="border-b border-line">
        <Container className="pt-14 pb-12 lg:pt-20 lg:pb-16">
          <HeroReveal>
            <Eyebrow>Work</Eyebrow>
            <h1 className="mt-4 max-w-3xl text-4xl text-navy-800">
              Engagements we can show the numbers for.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-muted">
              Every figure below came from the client&rsquo;s own analytics or CRM. Results describe
              those engagements and are not a prediction for anyone else.
            </p>
          </HeroReveal>
        </Container>
      </section>

      <section>
        <Container className="py-12 lg:py-16">
          {studies.length === 0 ? (
            <p className="py-16 text-center text-ink-subtle">No case studies are published yet.</p>
          ) : (
            <Stagger className="border-t border-line">
              {studies.map((study, index) => (
                <StaggerItem key={study.id}>
                  <Link
                    href={{ pathname: "/case-studies/[slug]", query: { slug: study.slug } }}
                    className="group grid gap-6 border-b border-line py-9 transition-colors hover:bg-surface-muted lg:grid-cols-12 lg:gap-8 lg:px-2"
                  >
                    <div className="lg:col-span-7">
                      <div className="flex items-baseline gap-4">
                        <IndexNumber value={index + 1} />
                        <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                          {study.clientName}
                          {study.service ? ` · ${study.service.name}` : ""}
                          {study.city ? ` · ${study.city.name}` : ""}
                        </p>
                      </div>
                      <h2 className="mt-3 max-w-xl font-display text-2xl text-navy-800 transition-colors group-hover:text-brand-red">
                        {study.title}
                      </h2>
                      <p className="mt-3 max-w-xl text-ink-muted">{study.summary}</p>
                    </div>

                    <div className="lg:col-span-4 lg:col-start-9">
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
                        {study.metrics.slice(0, 4).map((metric) => (
                          <div key={metric.label}>
                            <dd className="font-display text-xl tabular-nums text-navy-800">
                              {metric.value}
                              <span className="text-brand-red">{metric.unit}</span>
                            </dd>
                            <dt className="mt-0.5 text-xs text-ink-subtle">{metric.label}</dt>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </Link>
                </StaggerItem>
              ))}
            </Stagger>
          )}
        </Container>
      </section>
    </>
  );
}
