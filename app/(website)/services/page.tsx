import type { Metadata } from "next";
import Link from "next/link";
import { publishedServices } from "@/lib/content/queries";
import { Container, Eyebrow, IndexNumber } from "@/components/website/primitives";
import { HeroReveal, Stagger, StaggerItem } from "@/components/website/motion";

/**
 * Rendered at request time, with the underlying data cached and tagged.
 * A static route that reads the database would be prerendered at build,
 * forcing the container build to carry database credentials
 * (docs/ARCHITECTURE.md 17.2).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Services",
  description:
    "SEO, paid media, social, content, web development and marketing analytics — run as one programme.",
};

export default async function ServicesPage() {
  const services = await publishedServices();

  return (
    <>
      <section className="border-b border-line">
        <Container className="pt-14 pb-12 lg:pt-20 lg:pb-16">
          <HeroReveal>
            <Eyebrow>Services</Eyebrow>
            <h1 className="mt-4 max-w-3xl text-4xl text-navy-800">
              Six disciplines. One programme, measured end to end.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-muted">
              We rarely sell a single channel. The compounding comes from running them together
              against one definition of a qualified lead.
            </p>
          </HeroReveal>
        </Container>
      </section>

      <section>
        <Container className="py-12 lg:py-16">
          {services.length === 0 ? (
            <p className="py-16 text-center text-ink-subtle">
              No services are published yet.
            </p>
          ) : (
            <Stagger className="border-t border-line">
              {services.map((service, index) => (
                <StaggerItem key={service.id}>
                  <Link
                    href={{ pathname: "/services/[serviceSlug]", query: { serviceSlug: service.slug } }}
                    className="group grid gap-3 border-b border-line py-8 transition-colors duration-(--duration-fast) hover:bg-surface-muted lg:grid-cols-12 lg:gap-8 lg:px-2"
                  >
                    <div className="flex items-baseline gap-4 lg:col-span-5">
                      <IndexNumber value={index + 1} />
                      <h2 className="font-display text-2xl text-navy-800 transition-colors group-hover:text-brand-red">
                        {service.name}
                      </h2>
                    </div>
                    <p className="text-lg leading-relaxed text-ink-muted lg:col-span-6">
                      {service.shortDescription}
                    </p>
                    <span
                      aria-hidden="true"
                      className="hidden text-brand-red opacity-0 transition-opacity group-hover:opacity-100 lg:col-span-1 lg:block lg:text-right"
                    >
                      →
                    </span>
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
