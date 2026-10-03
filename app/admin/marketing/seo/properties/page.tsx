import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { seoPropertyListSchema } from "@/lib/validation/seo-intel";
import { Badge, Button, Input, Select, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../seo-header";

export const metadata: Metadata = { title: "SEO websites" };
export const dynamic = "force-dynamic";

export default async function SeoPropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/marketing/seo/properties");
  requirePermission(actor, "seo.intelligence.view");

  const parsed = seoPropertyListSchema.safeParse(await searchParams);
  const filters = parsed.success ? parsed.data : seoPropertyListSchema.parse({});

  const [properties, clients] = await Promise.all([
    listProperties(actor, filters),
    db.client.findMany({
      where: { deletedAt: null, seoProperties: { some: {} } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const canManage = can(actor, "seo.intelligence.manage");
  const filtered = Boolean(filters.client || filters.q || filters.status !== "active");

  return (
    <>
      <SeoHeader
        current="properties"
        title="Websites"
        description="Every website SEO Intelligence analyses. A client can have several; each keeps its own data, and none of it is visible from another client's."
      />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-2" role="search">
          <label className="sr-only" htmlFor="seo-q">
            Search websites
          </label>
          <Input id="seo-q" name="q" defaultValue={filters.q} placeholder="Domain, name or client" className="w-56" />
          <label className="sr-only" htmlFor="seo-client">
            Client
          </label>
          <Select id="seo-client" name="client" defaultValue={filters.client ?? ""} className="w-48">
            <option value="">All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
          <label className="sr-only" htmlFor="seo-status">
            Status
          </label>
          <Select id="seo-status" name="status" defaultValue={filters.status} className="w-36">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </Select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
        {canManage ? (
          <Link href="/admin/marketing/seo/properties/new">
            <Button>Add website</Button>
          </Link>
        ) : null}
      </div>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Website</TH>
              <TH>Client</TH>
              <TH>Main market</TH>
              <TH>Search Console</TH>
              <TH>Tasks go to</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {properties.length === 0 ? (
              <TableEmpty
                colSpan={6}
                title={filtered ? "No websites match these filters." : "No websites yet."}
                description={
                  filtered
                    ? undefined
                    : canManage
                      ? "Add a client's website — or your own — to start."
                      : "Someone with SEO management access can add one."
                }
              />
            ) : (
              properties.map((property) => (
                <TR key={property.id}>
                  <TD>
                    <Link
                      href={canManage ? `/admin/marketing/seo/properties/${property.id}` : `/admin/marketing/seo?property=${property.id}`}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {property.displayName}
                    </Link>
                    <div className="font-mono text-2xs text-ink-subtle">{property.domain}</div>
                  </TD>
                  <TD className="text-ink-muted">
                    {property.client.name}
                    {property.client.isInternal ? (
                      <span className="ml-2 align-middle">
                        <Badge tone="neutral">Our agency</Badge>
                      </span>
                    ) : null}
                  </TD>
                  <TD className="text-ink-muted">{property.defaultCountry?.name ?? "—"}</TD>
                  <TD>
                    {property.gscSiteUrl ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Not connected</Badge>}
                  </TD>
                  <TD className="text-xs text-ink-muted">{property.project ? `${property.project.code} — ${property.project.name}` : "—"}</TD>
                  <TD>{property.isActive ? <Badge tone="navy">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
    </>
  );
}
