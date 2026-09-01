import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listPages } from "@/lib/services/serviceCityPage.service";
import { Badge, Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";

export const metadata: Metadata = { title: "Service × City pages" };

export default async function ServiceCitiesAdminPage() {
  const actor = await requireActorPage("/admin/catalog/service-cities");
  const pages = await listPages(actor);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/catalog" className="hover:text-navy-800">
              Catalog
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Service × City</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Local pages</h1>
          <p className="mt-1.5 max-w-2xl text-xs text-ink-subtle">
            A page publishes only once it carries genuine local substance. Thin pages stay in draft
            and are excluded from the sitemap.
          </p>
        </div>
        {can(actor, "catalog.create") ? (
          <Link href="/admin/catalog/service-cities/new">
            <Button size="sm">Add local page</Button>
          </Link>
        ) : null}
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Service</TH>
              <TH>City</TH>
              <TH>FAQs</TH>
              <TH>Status</TH>
              <TH>Published</TH>
            </TR>
          </THead>
          <TBody>
            {pages.length === 0 ? (
              <TableEmpty
                colSpan={5}
                title="No local pages yet"
                description="Create one for a service and city combination."
              />
            ) : (
              pages.map((page) => (
                <TR key={page.id}>
                  <TD>
                    <Link
                      href={{
                        pathname: "/admin/catalog/service-cities/[pageId]",
                        query: { pageId: page.id },
                      }}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {page.service.name}
                    </Link>
                  </TD>
                  <TD className="text-ink-muted">
                    {page.city.name}
                    {page.city.isActive ? null : (
                      <Badge tone="warning" className="ml-2">
                        City inactive
                      </Badge>
                    )}
                  </TD>
                  <TD className="tabular-nums">{page._count.faqs}</TD>
                  <TD>
                    <Badge tone={page.status === "PUBLISHED" ? "success" : "neutral"}>
                      {page.status}
                    </Badge>
                  </TD>
                  <TD className="text-xs text-ink-subtle">
                    {page.publishedAt ? page.publishedAt.toISOString().slice(0, 10) : "—"}
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
