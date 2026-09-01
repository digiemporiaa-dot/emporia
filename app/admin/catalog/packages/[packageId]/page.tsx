import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getPackage } from "@/lib/services/package.service";
import { isAppError } from "@/lib/errors";
import { formatMoney, lineTotals } from "@/lib/money";
import { Badge, Card, CardBody } from "@/components/ui";
import { PackageForm } from "../package-form";

export const metadata: Metadata = { title: "Edit package" };

export default async function EditPackagePage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  const actor = await requireActorPage("/admin/catalog/packages");
  requirePermission(actor, "catalog.edit");

  let pkg;
  try {
    pkg = await getPackage(actor, packageId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const services = await db.service.findMany({
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });

  // Computed with the same lib/money code that prices a proposal and an
  // invoice, so what the admin sees here is what a client is quoted.
  const totals = lineTotals({
    quantity: 1,
    unitPrice: pkg.price.toString(),
    taxRate: pkg.taxRate.toString(),
  });

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/catalog/packages" className="hover:text-navy-800">
            Packages
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{pkg.name}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{pkg.name}</h1>
          <Badge tone={pkg.status === "PUBLISHED" ? "success" : "neutral"}>{pkg.status}</Badge>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 max-w-3xl">
          <PackageForm
            services={services}
            pkg={{
              id: pkg.id,
              name: pkg.name,
              slug: pkg.slug,
              tagline: pkg.tagline,
              serviceId: pkg.serviceId,
              price: pkg.price.toString(),
              currency: pkg.currency,
              taxRate: pkg.taxRate.toString(),
              billingType: pkg.billingType,
              isRecommended: pkg.isRecommended,
              status: pkg.status,
              order: pkg.order,
              metaTitle: pkg.seo?.metaTitle ?? null,
              metaDescription: pkg.seo?.metaDescription ?? null,
              features: pkg.features.map((f) => ({
                label: f.label,
                detail: f.detail ?? "",
                isIncluded: f.isIncluded,
              })),
            }}
          />
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <Card>
            <CardBody>
              <h2 className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                What a client is quoted
              </h2>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Price</dt>
                  <dd className="tabular-nums text-navy-800">
                    {formatMoney(pkg.price.toString(), pkg.currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">Tax ({pkg.taxRate.toString()}%)</dt>
                  <dd className="tabular-nums text-navy-800">
                    {formatMoney(totals.tax, pkg.currency)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4 border-t border-line pt-1.5 font-medium">
                  <dt className="text-navy-800">Total</dt>
                  <dd className="tabular-nums text-navy-800">
                    {formatMoney(totals.total, pkg.currency)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-ink-subtle">
                Calculated by the same code that prices proposals and invoices.
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
