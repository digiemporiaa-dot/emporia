import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listPackages } from "@/lib/services/package.service";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";

export const metadata: Metadata = { title: "Packages" };

export default async function PackagesAdminPage() {
  const actor = await requireActorPage("/admin/catalog/packages");
  const packages = await listPackages(actor);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/catalog" className="hover:text-navy-800">
              Catalog
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Packages</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Packages</h1>
        </div>
        {can(actor, "catalog.create") ? (
          <Link href="/admin/catalog/packages/new">
            <Button size="sm">Add package</Button>
          </Link>
        ) : null}
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Package</TH>
              <TH>Service</TH>
              <TH className="text-right">Price</TH>
              <TH className="text-right">Tax</TH>
              <TH>Billing</TH>
              <TH>Features</TH>
              <TH>Leads</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {packages.length === 0 ? (
              <TableEmpty colSpan={8} title="No packages yet" description="Add one to show on the site." />
            ) : (
              packages.map((pkg) => (
                <TR key={pkg.id}>
                  <TD>
                    <Link
                      href={{
                        pathname: "/admin/catalog/packages/[packageId]",
                        query: { packageId: pkg.id },
                      }}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {pkg.name}
                    </Link>
                    {pkg.isRecommended ? (
                      <Badge tone="red" className="ml-2">
                        Recommended
                      </Badge>
                    ) : null}
                  </TD>
                  <TD className="text-ink-muted">{pkg.service?.name ?? "—"}</TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(pkg.price.toString(), pkg.currency)}
                  </TD>
                  <TD className="text-right tabular-nums text-ink-subtle">
                    {pkg.taxRate.toString()}%
                  </TD>
                  <TD className="text-xs text-ink-muted">{pkg.billingType.toLowerCase().replace("_", " ")}</TD>
                  <TD className="tabular-nums">{pkg._count.features}</TD>
                  <TD className="tabular-nums">{pkg._count.leads}</TD>
                  <TD>
                    <Badge tone={pkg.status === "PUBLISHED" ? "success" : "neutral"}>{pkg.status}</Badge>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
    </>
  );
}
