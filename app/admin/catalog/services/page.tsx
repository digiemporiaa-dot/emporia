import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listServices } from "@/lib/services/service.service";
import {
  Badge,
  Button,
  Table,
  TableEmpty,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

export const metadata: Metadata = { title: "Services" };

export default async function ServicesAdminPage() {
  const actor = await requireActorPage("/admin/catalog/services");
  const services = await listServices(actor);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/catalog" className="hover:text-navy-800">
              Catalog
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Services</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Services</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-subtle">
            The spine of the site: every service page, every service-city page and every package is
            hung off one of these.
          </p>
        </div>
        {can(actor, "catalog.create") ? (
          <Link href="/admin/catalog/services/new">
            <Button size="sm">Add service</Button>
          </Link>
        ) : null}
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Service</TH>
              <TH>Slug</TH>
              <TH className="text-right">City pages</TH>
              <TH className="text-right">Packages</TH>
              <TH className="text-right">Case studies</TH>
              <TH className="text-right">Leads</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {services.length === 0 ? (
              <TableEmpty
                colSpan={7}
                title="No services yet"
                description="Add the first one — service pages, local pages and packages all need it."
              />
            ) : (
              services.map((service) => (
                <TR key={service.id}>
                  <TD>
                    <Link
                      href={`/admin/catalog/services/${service.id}`}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {service.name}
                    </Link>
                    <p className="mt-0.5 max-w-md truncate text-xs text-ink-subtle">
                      {service.shortDescription}
                    </p>
                  </TD>
                  <TD className="font-mono text-xs text-ink-muted">{service.slug}</TD>
                  <TD className="text-right tabular-nums">{service._count.cityPages}</TD>
                  <TD className="text-right tabular-nums">{service._count.packages}</TD>
                  <TD className="text-right tabular-nums">{service._count.caseStudies}</TD>
                  <TD className="text-right tabular-nums">{service._count.leads}</TD>
                  <TD>
                    <Badge tone={service.status === "PUBLISHED" ? "success" : "neutral"}>
                      {service.status}
                    </Badge>
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
