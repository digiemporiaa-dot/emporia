import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { publishedPackages } from "@/lib/content/queries";
import { formatMoney } from "@/lib/money";
import { Container, CtaButton, Eyebrow } from "@/components/website/primitives";
import { HeroReveal, Reveal } from "@/components/website/motion";

/**
 * Rendered at request time, with the underlying data cached and tagged.
 * A static route that reads the database would be prerendered at build,
 * forcing the container build to carry database credentials
 * (docs/ARCHITECTURE.md 17.2).
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    path: "/packages",
    fallback: {
      title: "Packages",
      description:
        "Indicative monthly packages for SEO, paid media and full-funnel programmes. Prices in INR, excluding tax.",
    },
  });
}

const BILLING_LABEL: Record<string, string> = {
  ONE_TIME: "one-time",
  MONTHLY: "per month",
  QUARTERLY: "per quarter",
  ANNUAL: "per year",
  RETAINER: "per month, retainer",
};

export default async function PackagesPage() {
  const packages = await publishedPackages();

  if (packages.length === 0) {
    return (
      <Container className="py-24">
        <p className="text-center text-ink-subtle">No packages are published yet.</p>
      </Container>
    );
  }

  // The comparison grid is driven by the union of feature labels across
  // packages, so adding a feature to one package cannot silently drop a row.
  const featureLabels: string[] = [];
  for (const pkg of packages) {
    for (const feature of pkg.features) {
      if (!featureLabels.includes(feature.label)) featureLabels.push(feature.label);
    }
  }

  const featureMap = new Map(
    packages.map((pkg) => [pkg.id, new Map(pkg.features.map((f) => [f.label, f]))]),
  );

  return (
    <>
      <section className="border-b border-line">
        <Container className="pt-14 pb-12 lg:pt-20 lg:pb-14">
          <HeroReveal>
            <Eyebrow>Packages</Eyebrow>
            <h1 className="mt-4 max-w-3xl text-4xl text-navy-800">
              Starting points, priced honestly.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-muted">
              Most engagements end up somewhere between these. Prices exclude tax and media spend,
              and the final figure comes in a written proposal.
            </p>
          </HeroReveal>
        </Container>
      </section>

      {/* Summary row */}
      <section className="border-b border-line">
        <Container className="py-12">
          <div className="grid min-w-0 gap-px bg-line lg:grid-cols-3">
            {packages.map((pkg) => (
              <Reveal key={pkg.id} className="min-w-0 bg-white">
                <div className="flex h-full flex-col p-7">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-display text-xl text-navy-800">{pkg.name}</h2>
                    {pkg.isRecommended ? (
                      <span className="rounded-xs bg-brand-red px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-white">
                        Most chosen
                      </span>
                    ) : null}
                  </div>
                  {pkg.tagline ? <p className="mt-2.5 text-sm text-ink-muted">{pkg.tagline}</p> : null}

                  <p className="mt-6 font-display text-3xl tabular-nums text-navy-800 lg:text-4xl">
                    {formatMoney(pkg.price, pkg.currency)}
                  </p>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {BILLING_LABEL[pkg.billingType] ?? "per month"} · excl. {pkg.taxRate}% tax
                  </p>

                  <div className="mt-7 flex-1" />
                  <div className="flex flex-wrap gap-2">
                    <CtaButton href="/contact" variant={pkg.isRecommended ? "primary" : "outline"}>
                      Request a proposal
                    </CtaButton>
                    <Link
                      href={{ pathname: "/packages/[packageSlug]", query: { packageSlug: pkg.slug } }}
                      className="inline-flex h-10 items-center px-2 text-sm font-medium text-navy-700 underline underline-offset-4 hover:text-brand-red"
                    >
                      Details
                    </Link>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Comparison. A real table, because that is what this data is. */}
      <section className="border-b border-line">
        <Container className="py-12 lg:py-16">
          <Eyebrow>Compare</Eyebrow>
          <h2 className="mt-4 text-2xl text-navy-800">What each package includes</h2>

          <div className="relative mt-8 overflow-x-auto">
            <table className="w-full min-w-[42rem] border-collapse text-sm">
              <caption className="sr-only">
                Features included in each package
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="w-2/5 border-b border-line-strong py-3 text-left text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                    Feature
                  </th>
                  {packages.map((pkg) => (
                    <th
                      key={pkg.id}
                      scope="col"
                      className="border-b border-line-strong py-3 text-left font-display text-base text-navy-800"
                    >
                      {pkg.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {featureLabels.map((label) => (
                  <tr key={label} className="transition-colors hover:bg-surface-muted">
                    <th scope="row" className="border-b border-line py-3 pr-4 text-left font-normal text-navy-800">
                      {label}
                    </th>
                    {packages.map((pkg) => {
                      const feature = featureMap.get(pkg.id)?.get(label);
                      const included = feature?.isIncluded ?? false;
                      return (
                        <td key={pkg.id} className="border-b border-line py-3 pr-4 align-top">
                          {included ? (
                            <span className="flex items-start gap-1.5 text-navy-800">
                              <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-red" />
                              <span className="sr-only">Included</span>
                              {feature?.detail ? (
                                <span className="text-xs text-ink-muted">{feature.detail}</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-ink-subtle">
                              <Minus size={15} aria-hidden="true" className="shrink-0" />
                              <span className="sr-only">Not included</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      <section className="bg-navy-800 text-white">
        <Container className="py-14 lg:py-18">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <h2 className="text-3xl">None of these quite fit?</h2>
              <p className="mt-4 max-w-xl text-navy-100">
                Most of our work is scoped from scratch. Tell us the number you are trying to move
                and we will price against that instead.
              </p>
            </div>
            <div className="lg:col-span-4 lg:col-start-9 lg:text-right">
              <CtaButton href="/contact" size="lg">
                Scope a custom package
              </CtaButton>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
