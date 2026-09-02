import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listCatalog } from "@/lib/services/sales.service";
import { formatMoney } from "@/lib/money";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { CatalogForm } from "./catalog-form";

export const metadata: Metadata = { title: "Quoting catalog" };
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const actor = await requireActorPage("/admin/sales/catalog");

  const [items, services] = await Promise.all([
    listCatalog(actor, true),
    db.service.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const editable = can(actor, "proposals.create") || can(actor, "proposals.edit");

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/sales" className="hover:text-navy-800">
            Sales
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">Catalog</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Quoting catalog</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Reusable priced lines. Adding one to a proposal copies its price across — later edits here
          never move a quote that has already been sent.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-3">
          {items.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-sm text-ink-subtle">
                  Nothing in the catalog yet. Add the services you quote most often.
                </p>
              </CardBody>
            </Card>
          ) : (
            items.map((item) => (
              <Card key={item.id}>
                <CardBody>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <h2 className="font-display text-base text-navy-800">
                        {item.name}
                        {item.isActive ? null : (
                          <Badge tone="neutral" className="ml-2 align-middle">
                            Inactive
                          </Badge>
                        )}
                      </h2>
                      {item.description ? (
                        <p className="mt-1 text-xs text-ink-subtle">{item.description}</p>
                      ) : null}
                      {item.service ? (
                        <p className="mt-1 text-2xs uppercase tracking-widest text-ink-subtle">
                          {item.service.name}
                        </p>
                      ) : null}
                    </div>
                    <p className="tabular-nums text-sm text-navy-800">
                      {formatMoney(item.unitPrice.toString(), item.currency)}
                      <span className="text-xs text-ink-subtle"> / {item.unit}</span>
                      <span className="ml-2 text-xs text-ink-subtle">
                        +{item.taxRate.toString()}% tax
                      </span>
                    </p>
                  </div>

                  {editable ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-ink-muted hover:text-brand-red">
                        Edit
                      </summary>
                      <div className="mt-3 border-t border-border pt-3">
                        <CatalogForm
                          item={{
                            id: item.id,
                            name: item.name,
                            description: item.description,
                            unit: item.unit,
                            unitPrice: item.unitPrice.toString(),
                            currency: item.currency,
                            taxRate: item.taxRate.toString(),
                            serviceId: item.service?.id ?? null,
                            isActive: item.isActive,
                            order: item.order,
                          }}
                          services={services}
                        />
                      </div>
                    </details>
                  ) : null}
                </CardBody>
              </Card>
            ))
          )}
        </div>

        {editable ? (
          <Card>
            <CardHeader>
              <CardTitle>Add an item</CardTitle>
            </CardHeader>
            <CardBody>
              <CatalogForm services={services} />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
