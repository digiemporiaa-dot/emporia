import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listCities } from "@/lib/services/city.service";
import { Badge, Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";

export const metadata: Metadata = { title: "Cities" };

export default async function CitiesAdminPage() {
  const actor = await requireActorPage("/admin/catalog/cities");
  // listCities performs the permission check itself.
  const cities = await listCities(actor);
  const canEdit = can(actor, "catalog.edit");

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/catalog" className="hover:text-navy-800">
              Catalog
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Cities</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Cities</h1>
        </div>
        {can(actor, "catalog.create") ? (
          <Link href="/admin/catalog/cities/new">
            <Button size="sm">Add city</Button>
          </Link>
        ) : null}
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>City</TH>
              <TH>State</TH>
              <TH>Slug</TH>
              <TH>Coordinates</TH>
              <TH>Local pages</TH>
              <TH>Status</TH>
              <TH>Order</TH>
            </TR>
          </THead>
          <TBody>
            {cities.length === 0 ? (
              <TableEmpty
                colSpan={7}
                title="No cities yet"
                description="Add a city before creating local pages for it."
              />
            ) : (
              cities.map((city) => (
                <TR key={city.id}>
                  <TD>
                    {canEdit ? (
                      <Link
                        href={`/admin/catalog/cities/${city.id}`}
                        className="font-medium text-navy-800 hover:text-brand-red"
                      >
                        {city.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-navy-800">{city.name}</span>
                    )}
                  </TD>
                  <TD className="text-ink-muted">{city.state}</TD>
                  <TD className="font-mono text-xs text-ink-subtle">{city.slug}</TD>
                  <TD className="text-xs tabular-nums text-ink-subtle">
                    {city.latitude !== null && city.longitude !== null ? (
                      `${city.latitude.toFixed(4)}, ${city.longitude.toFixed(4)}`
                    ) : (
                      // LocalBusiness schema is withheld without real coordinates.
                      <span className="text-warning">not set</span>
                    )}
                  </TD>
                  <TD className="tabular-nums">{city._count.servicePages}</TD>
                  <TD>
                    <Badge tone={city.isActive ? "success" : "neutral"}>
                      {city.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TD>
                  <TD className="tabular-nums text-ink-subtle">{city.order}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
    </>
  );
}
