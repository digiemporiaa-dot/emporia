import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { CELL_STATUSES, localCoverage } from "@/lib/services/seo-intel/local.service";
import { Pagination } from "@/components/admin/pagination";
import { Card, CardBody, CardHeader, Input, Label, Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../seo-header";
import { DATE_TIME, FilterLinks, PropertyPicker, Stat, UrlCell } from "../crawl-parts";
import { formatCount } from "../overview-parts";
import { ActionForm } from "../action-form";
import { importLocalFromCmsAction, setLocalPageAction } from "./actions";
import { CELL_LABEL, CellBadge, HOW_LABEL, LocalNav, Notice } from "./local-parts";

export const metadata: Metadata = { title: "Local SEO" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  property: z.string().max(40).optional().catch(undefined),
  status: z.enum(CELL_STATUSES).optional().catch(undefined),
  cell: z.string().max(90).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
const PAGE_SIZE = 20;

export default async function LocalCoveragePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/local");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const canManage = can(actor, "seo.intelligence.manage");
  const description =
    "Every service in every city the website targets: which page serves it, whether Google can index that page, and how often people searched for the combination in the last 28 days. A page is matched when its address, title or H1 names both; you can choose a different one.";

  if (!property) {
    return (
      <>
        <SeoHeader current="local" title="Local SEO" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const coverage = await localCoverage(actor, property.id, { page: params.page, perPage: PAGE_SIZE, status: params.status ?? null, cell: params.cell ?? null });
  const base = `/admin/marketing/seo/local?property=${property.id}`;
  const empty = coverage.total === 0;
  const selected = coverage.selected;

  return (
    <>
      <SeoHeader current="local" title="Local SEO" description={description} query={`?property=${property.id}`} canConnect={canConnect} />
      <PropertyPicker id="local-property" properties={properties} current={property.id} />
      <LocalNav current="coverage" propertyId={property.id} />

      {empty ? (
        <Card className="mb-5">
          <CardBody className="space-y-3 text-sm text-ink-subtle">
            <p>
              No services or cities for this website yet.{" "}
              <Link href={`/admin/marketing/seo/local/setup?property=${property.id}` as Route} className="text-navy-800 underline underline-offset-2">
                Add the services it offers and the cities it targets
              </Link>
              .
            </p>
            {coverage.isInternal && canManage ? (
              <ActionForm action={importLocalFromCmsAction} label="Import from the CMS" pendingLabel="Importing…" variant="secondary" hidden={{ propertyId: property.id }}>
                <p className="text-xs">This is the agency&rsquo;s own website: its services and Service × City pages can be imported.</p>
              </ActionForm>
            ) : null}
          </CardBody>
        </Card>
      ) : (
        <>
          {!coverage.run ? (
            <Notice>
              No finished crawl yet, so no page can be matched.{" "}
              <Link href={`/admin/marketing/seo/crawl?property=${property.id}` as Route} className="text-navy-800 underline underline-offset-2">
                Crawl the website
              </Link>
              .
            </Notice>
          ) : null}
          {!coverage.range ? (
            <Notice>
              No Search Console data, so demand cannot be shown and gaps cannot be ranked.{" "}
              <Link href={`/admin/marketing/seo/properties/${property.id}/search-console` as Route} className="text-navy-800 underline underline-offset-2">
                Connect Search Console
              </Link>
              .
            </Notice>
          ) : null}

          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Covered" value={`${formatCount(coverage.counts.covered)} of ${formatCount(coverage.total)}`} note="Indexable page found" />
            <Stat label="No page" value={formatCount(coverage.counts.gap + coverage.counts.draft)} note={coverage.counts.draft ? `${coverage.counts.draft} with an unpublished CMS page` : "Service and city with no page"} />
            <Stat label="Searches with no page" value={coverage.range ? formatCount(coverage.gapDemand) : "—"} note="28-day impressions, Search Console" />
            <Stat label="Need attention" value={formatCount(coverage.counts["not-indexable"] + coverage.counts["not-crawled"])} note="Not indexable, or not in the crawl" />
          </div>

          {selected ? (
            <Card className="mb-5" id="cell">
              <CardHeader>
                <p className="text-2xs uppercase tracking-wide text-ink-subtle">Service in city</p>
                <h2 className="text-base text-navy-800">
                  {selected.serviceName} in {selected.cityName} <CellBadge status={selected.status} />
                </h2>
              </CardHeader>
              <CardBody className="space-y-4 text-sm">
                {selected.page ? (
                  <div>
                    <UrlCell url={selected.page.url} />
                    <p className="text-xs text-ink-muted">
                      {HOW_LABEL[selected.page.how]}
                      {selected.performance ? ` · ${formatCount(selected.performance.clicks)} clicks, ${formatCount(selected.performance.impressions)} impressions in 28 days` : ""}
                      {selected.performance?.position ? `, average position ${selected.performance.position.toFixed(1)}` : ""}
                    </p>
                  </div>
                ) : (
                  <p className="text-ink-muted">No page names both {selected.cityName} and {selected.serviceName}.</p>
                )}
                {selected.cms ? (
                  <p className="text-xs text-ink-muted">
                    CMS page:{" "}
                    <Link href={`/admin/catalog/service-cities/${selected.cms.id}` as Route} className="text-navy-800 underline underline-offset-2">
                      {selected.cms.status === "PUBLISHED" ? "published" : selected.cms.status === "DRAFT" ? "draft — see what it needs to publish" : "archived"}
                    </Link>
                  </p>
                ) : null}
                <div>
                  <p className="mb-1 text-2xs uppercase tracking-wide text-ink-subtle">Searches naming both (28 days)</p>
                  {selected.demand.queries.length ? (
                    <ul className="space-y-0.5 text-xs">
                      {selected.demand.queries.map((query) => (
                        <li key={query.query} className="flex flex-wrap justify-between gap-x-3">
                          <span className="text-navy-800">{query.query}</span>
                          <span className="tabular-nums text-ink-subtle">{formatCount(query.impressions)} impr. · {formatCount(query.clicks)} clicks</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-ink-subtle">None in Search Console for this period.</p>
                  )}
                </div>
                {canManage ? (
                  <ActionForm action={setLocalPageAction} label={selected.page?.how === "chosen" ? "Save" : "Use this page"} variant="secondary" hidden={{ propertyId: property.id, localServiceId: selected.serviceId, cityId: selected.cityId }}>
                    <div className="max-w-lg">
                      <Label htmlFor="cell-url">Page for this service in this city</Label>
                      <Input id="cell-url" name="url" type="url" inputMode="url" placeholder={`https://${property.domain}/…`} defaultValue={selected.page?.how === "chosen" ? selected.page.url : ""} />
                      <p className="mt-1 text-2xs text-ink-subtle">Leave empty and save to go back to the automatic match.</p>
                    </div>
                  </ActionForm>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <div className="mb-4">
            <FilterLinks
              label="Filter by status"
              items={[
                { key: "all", label: "All", href: base as Route, current: !params.status },
                ...CELL_STATUSES.map((status) => ({ key: status, label: CELL_LABEL[status], href: `${base}&status=${status}` as Route, current: params.status === status, count: coverage.counts[status] })),
              ]}
            />
          </div>

          <div className="space-y-5">
            {coverage.list.rows.length === 0 ? (
              <Card>
                <CardBody className="text-sm text-ink-subtle">No city has a service with this status.</CardBody>
              </Card>
            ) : null}
            {coverage.list.rows.map((city) => (
              <section key={city.cityId} className="min-w-0">
                <h2 className="mb-2 text-base text-navy-800">
                  {city.name} <span className="text-xs font-normal text-ink-subtle">{[city.state, city.country].filter(Boolean).join(", ")}</span>
                </h2>
                <TableWrap>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Service</TH>
                        <TH>Status</TH>
                        <TH>Page</TH>
                        <TH className="text-right">Searches</TH>
                        <TH className="text-right">Page clicks</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {city.cells
                        .filter((cell) => !params.status || cell.status === params.status)
                        .map((cell) => {
                          const name = coverage.services.find((service) => service.id === cell.serviceId)?.name ?? "";
                          const href = `${base}${params.status ? `&status=${params.status}` : ""}${params.page > 1 ? `&page=${params.page}` : ""}&cell=${cell.serviceId}:${cell.cityId}#cell`;
                          return (
                            <TR key={cell.serviceId}>
                              <TD>
                                <Link href={href as Route} className="text-navy-800 underline-offset-2 hover:underline">
                                  {name}
                                </Link>
                              </TD>
                              <TD>
                                <CellBadge status={cell.status} />
                              </TD>
                              <TD className="max-w-[18rem]">
                                {cell.page ? (
                                  <>
                                    <UrlCell url={cell.page.url} />
                                    <span className="block text-2xs text-ink-subtle">{HOW_LABEL[cell.page.how]}</span>
                                  </>
                                ) : (
                                  <span className="text-xs text-ink-subtle">—</span>
                                )}
                              </TD>
                              <TD className="text-right tabular-nums">{coverage.range ? formatCount(cell.demand.impressions) : "—"}</TD>
                              <TD className="text-right tabular-nums text-ink-muted">{cell.performance ? formatCount(cell.performance.clicks) : "—"}</TD>
                            </TR>
                          );
                        })}
                    </TBody>
                  </Table>
                </TableWrap>
              </section>
            ))}
          </div>
          <div className="mt-4">
            <Pagination
              basePath="/admin/marketing/seo/local"
              params={{ property: property.id, ...(params.status ? { status: params.status } : {}) }}
              page={coverage.list.page}
              pages={coverage.list.pages}
              total={coverage.list.total}
              perPage={PAGE_SIZE}
            />
          </div>
          <p className="mt-4 text-2xs text-ink-subtle">
            {coverage.run?.finishedAt ? `Pages from the crawl of ${DATE_TIME.format(coverage.run.finishedAt)}. ` : ""}
            {coverage.range ? `Searches are Search Console impressions for queries naming both the city and the service, ${coverage.range.start} to ${coverage.range.end}. ` : ""}
            Only pages in the HTML the crawler sees are matched.
          </p>
        </>
      )}
    </>
  );
}
