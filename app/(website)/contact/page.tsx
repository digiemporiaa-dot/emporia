import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { publishedServices, siteSettings } from "@/lib/content/queries";
import { Container, Eyebrow } from "@/components/website/primitives";
import { HeroReveal } from "@/components/website/motion";
import { ContactForm } from "./contact-form";

/**
 * Contact.
 *
 * Dynamic rather than ISR: the form posts to a server action and the page reads
 * live settings, so there is nothing worth caching here.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/contact",
    fallback: {
      title: "Contact",
      description:
        "Tell us what you are trying to move. We reply within one working day.",
    },
  });
}

export default async function ContactPage() {
  const [services, details] = await Promise.all([
    publishedServices(),
    siteSettings(["site.email", "site.phone", "site.address"]),
  ]);

  return (
    <section>
      <Container className="py-14 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <HeroReveal>
              <Eyebrow>Contact</Eyebrow>
              <h1 className="mt-4 text-4xl text-navy-800">
                Tell us what you are trying to move.
              </h1>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-ink-muted">
                A short call is usually enough to tell whether we can help. If we cannot, we will
                say so and point you somewhere better.
              </p>

              <dl className="mt-10 space-y-5 border-t border-line pt-8 text-sm">
                {details["site.email"] ? (
                  <div>
                    <dt className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                      Email
                    </dt>
                    <dd className="mt-1">
                      <a
                        href={`mailto:${details["site.email"]}`}
                        className="text-navy-800 underline underline-offset-4 hover:text-brand-red"
                      >
                        {details["site.email"]}
                      </a>
                    </dd>
                  </div>
                ) : null}

                {details["site.phone"] ? (
                  <div>
                    <dt className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                      Phone
                    </dt>
                    <dd className="mt-1">
                      <a
                        href={`tel:${details["site.phone"].replace(/\s+/g, "")}`}
                        className="text-navy-800 underline underline-offset-4 hover:text-brand-red"
                      >
                        {details["site.phone"]}
                      </a>
                    </dd>
                  </div>
                ) : null}

                {details["site.address"] ? (
                  <div>
                    <dt className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                      Office
                    </dt>
                    <dd className="mt-1 text-ink-muted">{details["site.address"]}</dd>
                  </div>
                ) : null}
              </dl>
            </HeroReveal>
          </div>

          <div className="lg:col-span-6 lg:col-start-7">
            <div className="border-t-2 border-navy-800 pt-8">
              <ContactForm services={services} />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
