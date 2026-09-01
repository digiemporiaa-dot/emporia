import type { Metadata } from "next";
import Link from "next/link";
import { activeCities } from "@/lib/content/queries";
import { Container, Eyebrow, IndexNumber } from "@/components/website/primitives";
import { HeroReveal, Stagger, StaggerItem } from "@/components/website/motion";
import { buildMetadata } from "@/lib/seo/metadata";

/**
 * Rendered at request time with the data cached and tagged
 * (docs/ARCHITECTURE.md 17.2).
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/cities",
    fallback: {
      title: "Where we work",
      description:
        "The cities we publish genuine local work for, with services tailored to each market.",
    },
  });
}

export default async function CitiesPage() {
  const cities = await activeCities();

  return (
    <>
      <section className="border-b border-line">
        <Container className="pt-14 pb-12 lg:pt-20 lg:pb-16">
          <HeroReveal>
            <Eyebrow>Locations</Eyebrow>
            <h1 className="mt-4 max-w-3xl text-4xl text-navy-800">Where we work.</h1>
            <p className="mt-6 max-w-xl text-lg text-ink-muted">
              We only list a city once we have real work and real local knowledge to show for it.
              That is why this list is short.
            </p>
          </HeroReveal>
        </Container>
      </section>

      <section>
        <Container className="py-12 lg:py-16">
          {cities.length === 0 ? (
            <p className="py-16 text-center text-ink-subtle">
              No city pages are published yet.
            </p>
          ) : (
            <Stagger className="border-t border-line">
              {cities.map((city, index) => (
                <StaggerItem key={city.id}>
                  <Link
                    href={{ pathname: "/cities/[citySlug]", query: { citySlug: city.slug } }}
                    className="group grid gap-2 border-b border-line py-6 transition-colors hover:bg-surface-muted lg:grid-cols-12 lg:items-baseline lg:gap-6 lg:px-2"
                  >
                    <div className="flex items-baseline gap-4 lg:col-span-5">
                      <IndexNumber value={index + 1} />
                      <h2 className="font-display text-2xl text-navy-800 transition-colors group-hover:text-brand-red">
                        {city.name}
                      </h2>
                    </div>
                    <p className="text-ink-muted lg:col-span-5">{city.state}</p>
                    <p className="text-xs text-ink-subtle lg:col-span-2 lg:text-right">
                      {city.publishedPageCount}{" "}
                      {city.publishedPageCount === 1 ? "service" : "services"}
                    </p>
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
