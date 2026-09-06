import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { Card, CardBody } from "@/components/ui";

export const metadata: Metadata = { title: "Catalog" };

export default async function CatalogPage() {
  const actor = await requireActorPage("/admin/catalog");
  requirePermission(actor, "catalog.view");

  const [cities, activeCities, pages, publishedPages, packages, livePackages] = await Promise.all([
    db.city.count(),
    db.city.count({ where: { isActive: true } }),
    db.serviceCityPage.count(),
    db.serviceCityPage.count({ where: { status: "PUBLISHED" } }),
    db.servicePackage.count(),
    db.servicePackage.count({ where: { status: "PUBLISHED" } }),
  ]);

  const sections = [
    {
      href: "/admin/catalog/cities" as const,
      title: "Cities",
      detail: `${activeCities} active of ${cities}`,
      description: "Locations we publish local pages for. Deactivating hides a city and its pages.",
    },
    {
      href: "/admin/catalog/service-cities" as const,
      title: "Service × City pages",
      detail: `${publishedPages} published of ${pages}`,
      description:
        "Local pages. A page only publishes once it has genuine local content — thin pages stay in draft.",
    },
    {
      href: "/admin/catalog/packages" as const,
      title: "Packages",
      detail: `${livePackages} published of ${packages}`,
      description:
        "Pricing, features and tax. Prices stay Decimal from this form to the invoice.",
    },
  ];

  return (
    <>
      <header className="mb-7">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">Catalog</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Services, cities and local pages</h1>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((section) => (
          <Link key={section.href} href={section.href} className="group">
            <Card className="h-full transition-colors group-hover:border-navy-300">
              <CardBody>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                    {section.title}
                  </h2>
                  <span className="text-xs tabular-nums text-ink-subtle">{section.detail}</span>
                </div>
                <p className="mt-2 text-xs text-ink-subtle">{section.description}</p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
