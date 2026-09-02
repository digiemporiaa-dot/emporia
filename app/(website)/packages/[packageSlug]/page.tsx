import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Minus } from "lucide-react";
import { db } from "@/lib/db";
import { formatMoney, lineTotals } from "@/lib/money";
import { Container, CtaButton, Eyebrow } from "@/components/website/primitives";
import { Breadcrumbs } from "@/components/website/breadcrumbs";
import { JsonLd } from "@/components/website/json-ld";
import { buildMetadata, privateMetadata } from "@/lib/seo/metadata";
import { seoSelect } from "@/lib/seo/select";
import { faqSchema, offerSchema } from "@/lib/seo/schema";
import { HeroReveal, Reveal } from "@/components/website/motion";

export const revalidate = 3600;

async function getPackage(slug: string) {
  return db.servicePackage.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: {
      id: true,
      slug: true,
      name: true,
      tagline: true,
      price: true,
      currency: true,
      taxRate: true,
      billingType: true,
      isRecommended: true,
      seo: { select: seoSelect },
      service: { select: { slug: true, name: true } },
      features: { orderBy: { order: "asc" }, select: { id: true, label: true, detail: true, isIncluded: true } },
      faqs: {
        where: { isActive: true },
        orderBy: { order: "asc" },
        select: { id: true, question: true, answer: true },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ packageSlug: string }>;
}): Promise<Metadata> {
  const { packageSlug } = await params;
  const pkg = await getPackage(packageSlug);
  if (!pkg) return privateMetadata("Not found");

  return buildMetadata({
    path: `/packages/${pkg.slug}`,
    seo: pkg.seo,
    fallback: { title: `${pkg.name} package`, description: pkg.tagline },
  });
}

export default async function PackageDetailPage({
  params,
}: {
  params: Promise<{ packageSlug: string }>;
}) {
  const { packageSlug } = await params;
  const pkg = await getPackage(packageSlug);
  if (!pkg) notFound();

  // Tax is computed with lib/money, the same code that prices a proposal, so
  // the figure quoted here and the figure invoiced later cannot diverge.
  const totals = lineTotals({
    quantity: 1,
    unitPrice: pkg.price.toString(),
    taxRate: pkg.taxRate.toString(),
  });

  const schema = [
    await offerSchema({
      name: pkg.name,
      description: pkg.tagline,
      price: pkg.price.toString(),
      currency: pkg.currency,
      path: `/packages/${pkg.slug}`,
    }),
    faqSchema(pkg.faqs),
  ];

  const others = await db.servicePackage.findMany({
    where: { status: "PUBLISHED", id: { not: pkg.id } },
    orderBy: { order: "asc" },
    select: { id: true, slug: true, name: true, tagline: true, price: true, currency: true },
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
                { name: "Packages", path: "/packages" },
                { name: pkg.name, path: `/packages/${pkg.slug}` },
              ]}
            />

            <div className="mt-8 grid gap-10 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <div className="flex items-center gap-3">
                  <h1 className="text-4xl text-navy-800">{pkg.name}</h1>
                  {pkg.isRecommended ? (
                    <span className="rounded-xs bg-brand-red px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-white">
                      Most chosen
                    </span>
                  ) : null}
                </div>
                {pkg.tagline ? (
                  <p className="mt-5 max-w-xl text-lg text-ink-muted">{pkg.tagline}</p>
                ) : null}
                {pkg.service ? (
                  <p className="mt-5 text-sm text-ink-subtle">
                    Built around{" "}
                    <Link
                      href={`/services/${pkg.service.slug}`}
                      className="text-brand-red underline underline-offset-4"
                    >
                      {pkg.service.name}
                    </Link>
                  </p>
                ) : null}
              </div>

              <div className="lg:col-span-4 lg:col-start-9">
                <div className="border-t-2 border-navy-800 pt-5">
                  <p className="font-display text-3xl tabular-nums text-navy-800 lg:text-4xl">
                    {formatMoney(pkg.price.toString(), pkg.currency)}
                  </p>
                  <dl className="mt-4 space-y-1.5 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-ink-subtle">Tax ({pkg.taxRate.toString()}%)</dt>
                      <dd className="tabular-nums text-navy-800">
                        {formatMoney(totals.tax, pkg.currency)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-line pt-1.5 font-medium">
                      <dt className="text-navy-800">Total per month</dt>
                      <dd className="tabular-nums text-navy-800">
                        {formatMoney(totals.total, pkg.currency)}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-6">
                    <CtaButton href="/contact" size="lg" className="w-full">
                      Request a proposal
                    </CtaButton>
                  </div>
                  <p className="mt-3 text-xs text-ink-subtle">
                    Excludes media spend. Final pricing is confirmed in writing.
                  </p>
                </div>
              </div>
            </div>
          </HeroReveal>
        </Container>
      </section>

      <section className="border-b border-line">
        <Container className="py-14 lg:py-18">
          <Reveal>
            <Eyebrow>Included</Eyebrow>
            <h2 className="mt-4 text-2xl text-navy-800">What you get each month</h2>
          </Reveal>

          <ul className="mt-8 grid gap-x-10 border-t border-line sm:grid-cols-2">
            {pkg.features.map((feature) => (
              <li
                key={feature.id}
                className="flex items-start gap-3 border-b border-line py-3.5"
              >
                {feature.isIncluded ? (
                  <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-red" />
                ) : (
                  <Minus size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-subtle" />
                )}
                <span>
                  <span className={feature.isIncluded ? "text-navy-800" : "text-ink-subtle line-through"}>
                    {feature.label}
                  </span>
                  {feature.detail ? (
                    <span className="block text-xs text-ink-subtle">{feature.detail}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {pkg.faqs.length > 0 ? (
        <section className="border-b border-line">
          <Container className="py-14" width="narrow">
            <Eyebrow>Questions</Eyebrow>
            <dl className="mt-6 border-t border-line">
              {pkg.faqs.map((faq) => (
                <div key={faq.id} className="border-b border-line py-5">
                  <dt className="font-display text-lg text-navy-800">{faq.question}</dt>
                  <dd className="mt-2 text-ink-muted">{faq.answer}</dd>
                </div>
              ))}
            </dl>
          </Container>
        </section>
      ) : null}

      {others.length > 0 ? (
        <section>
          <Container className="py-14">
            <h2 className="text-2xl text-navy-800">Other packages</h2>
            <div className="mt-7 grid gap-px bg-line sm:grid-cols-2">
              {others.map((other) => (
                <Link
                  key={other.id}
                  href={`/packages/${other.slug}`}
                  className="group bg-white p-6 transition-colors hover:bg-surface-muted"
                >
                  <h3 className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                    {other.name}
                  </h3>
                  {other.tagline ? (
                    <p className="mt-2 text-sm text-ink-muted">{other.tagline}</p>
                  ) : null}
                  <p className="mt-4 font-display text-xl tabular-nums text-navy-800">
                    {formatMoney(other.price.toString(), other.currency)}
                  </p>
                </Link>
              ))}
            </div>
          </Container>
        </section>
      ) : null}
    </>
  );
}
