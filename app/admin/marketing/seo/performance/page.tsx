import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { GSC_SORTS, listGscRows } from "@/lib/services/seo-intel/overview.service";
import { SEO_PERIOD_LABEL, SEO_PERIODS } from "@/lib/seo-intel/periods";
import { ctr } from "@/lib/seo-intel/normalize/gsc";
import { Pagination } from "@/components/admin/pagination";
import { Button, Card, CardBody, Input, Select, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../seo-header";
import { formatCount, formatPct, formatPosition, formatRange } from "../overview-parts";

export const metadata: Metadata = { title: "Search performance" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  property: z.string().max(40).optional(),
  period: z.enum(SEO_PERIODS).catch("28d"),
  view: z.enum(["queries", "pages"]).catch("queries"),
  q: z.string().trim().max(200).optional().catch(undefined),
  sort: z.enum(GSC_SORTS).catch("clicks"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

const PAGE_SIZE = 50;

/**
 * Every query and page Search Console reported for a website, searched,
 * sorted and paginated in the database — never loaded whole into the browser.
 */
export default async function SearchPerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/marketing/seo/performance");
  requirePermission(actor, "seo.intelligence.view");

  const raw = await searchParams;
  const params = paramsSchema.parse({ ...raw, property: typeof raw["property"] === "string" ? raw["property"] : undefined });
  const keys = (Array.isArray(raw["key"]) ? raw["key"] : typeof raw["key"] === "string" ? [raw["key"]] : []).filter((key) => key.length <= 2000).slice(0, 50);

  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");

  if (!property) {
    return (
      <>
        <SeoHeader current="performance" title="Search performance" canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const result = await listGscRows(actor, property.id, {
    dimension: params.view === "pages" ? "page" : "query",
    period: params.period,
    q: params.q,
    sort: params.sort,
    page: params.page,
    pageSize: PAGE_SIZE,
    keys,
  });

  const link = (overrides: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = { property: property.id, period: params.period, view: params.view, sort: params.sort, q: params.q, ...overrides };
    for (const [key, value] of Object.entries(merged)) if (value) query.set(key, value);
    return `/admin/marketing/seo/performance?${query}` as Route;
  };

  return (
    <>
      <SeoHeader
        current="performance"
        title="Search performance"
        description="Queries and pages from Search Console, with the change against the comparison period. Positions are impression-weighted averages."
        query={`?property=${property.id}`}
        canConnect={canConnect}
      />

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="period" value={params.period} />
        <input type="hidden" name="view" value={params.view} />
        <input type="hidden" name="sort" value={params.sort} />
        <label htmlFor="perf-property" className="sr-only">
          Website
        </label>
        <Select id="perf-property" name="property" defaultValue={property.id} className="w-full max-w-sm">
          {properties.map((option) => (
            <option key={option.id} value={option.id}>
              {option.client.name} — {option.displayName}
            </option>
          ))}
        </Select>
        <label htmlFor="perf-q" className="sr-only">
          Search
        </label>
        <Input id="perf-q" name="q" defaultValue={params.q} placeholder={params.view === "pages" ? "Part of a URL" : "Part of a query"} className="w-56" />
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Rows" className="flex gap-1">
          {(["queries", "pages"] as const).map((view) => (
            <Link
              key={view}
              href={link({ view, page: undefined })}
              aria-current={view === params.view ? "page" : undefined}
              className={view === params.view ? "rounded-md bg-navy-800 px-2.5 py-1 text-xs font-medium text-white" : "rounded-md border border-line bg-white px-2.5 py-1 text-xs text-ink-muted hover:text-navy-800"}
            >
              {view === "queries" ? "Queries" : "Pages"}
            </Link>
          ))}
        </nav>
        <nav aria-label="Comparison period" className="flex flex-wrap gap-1">
          {SEO_PERIODS.map((key) => (
            <Link
              key={key}
              href={link({ period: key })}
              aria-current={key === params.period ? "page" : undefined}
              className={key === params.period ? "rounded-md bg-navy-800 px-2.5 py-1 text-xs font-medium text-white" : "rounded-md border border-line bg-white px-2.5 py-1 text-xs text-ink-muted hover:text-navy-800"}
            >
              {SEO_PERIOD_LABEL[key]}
            </Link>
          ))}
        </nav>
      </div>

      {keys.length ? (
        <p role="status" className="mb-3 rounded-md border border-line bg-white px-3.5 py-2.5 text-xs text-ink-muted">
          Showing the {keys.length} {params.view} named by a “What changed” finding.{" "}
          <Link href={link({})} className="text-navy-800 underline underline-offset-2">
            Show all
          </Link>
        </p>
      ) : null}

      {result.state === "no-data" ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">
              No Search Console data for this website yet.{" "}
              <Link href={`/admin/marketing/seo/properties/${property.id}/search-console`} className="text-navy-800 underline underline-offset-2">
                {property.gscSiteUrl ? "See its sync status" : "Connect Search Console"}
              </Link>
              .
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <p className="mb-2 text-2xs text-ink-subtle">
            {formatRange(result.period.current)} vs {formatRange(result.period.previous)} · {formatCount(result.total)} {params.view}
          </p>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>{params.view === "pages" ? "Page" : "Query"}</TH>
                  {GSC_SORTS.map((sort) => (
                    <TH key={sort} className="text-right">
                      <Link
                        href={link({ sort, page: undefined })}
                        aria-current={sort === params.sort ? "true" : undefined}
                        className={sort === params.sort ? "font-semibold text-navy-800" : "hover:text-navy-800"}
                      >
                        {sort === "ctr" ? "CTR" : sort === "position" ? "Position" : sort[0]!.toUpperCase() + sort.slice(1)}
                        {sort === params.sort ? <span aria-hidden="true"> ↓</span> : null}
                      </Link>
                    </TH>
                  ))}
                  <TH className="text-right">Clicks before</TH>
                </TR>
              </THead>
              <TBody>
                {result.rows.length === 0 ? (
                  <TableEmpty colSpan={6} title={params.q || keys.length ? "Nothing matches." : "Nothing reported in this period."} />
                ) : (
                  result.rows.map((row) => {
                    const change = row.previous && row.previous.clicks > 0 ? (row.current.clicks - row.previous.clicks) / row.previous.clicks : null;
                    return (
                      <TR key={row.key}>
                        <TD className="max-w-[28rem]">
                          {params.view === "pages" ? (
                            <a href={row.key} target="_blank" rel="noreferrer noopener" className="block truncate font-mono text-2xs text-navy-800 hover:text-brand-red" title={row.key}>
                              {row.key}
                            </a>
                          ) : (
                            <span className="block truncate text-navy-800" title={row.key}>
                              {row.key}
                            </span>
                          )}
                        </TD>
                        <TD className="text-right tabular-nums">
                          {formatCount(row.current.clicks)}
                          {change !== null && Math.abs(change) >= 0.005 ? (
                            <span className={`ml-1 text-2xs ${change > 0 ? "text-success" : "text-brand-red-text"}`}>
                              {change > 0 ? "+" : "−"}
                              {Math.abs(change * 100).toFixed(0)}%
                            </span>
                          ) : null}
                        </TD>
                        <TD className="text-right tabular-nums text-ink-muted">{formatCount(row.current.impressions)}</TD>
                        <TD className="text-right tabular-nums text-ink-muted">{formatPct(ctr(row.current))}</TD>
                        <TD className="text-right tabular-nums text-ink-muted">
                          {formatPosition(row.current.position)}
                          {row.previous && row.previous.impressions > 0 ? <span className="ml-1 text-2xs text-ink-subtle">was {formatPosition(row.previous.position)}</span> : null}
                        </TD>
                        <TD className="text-right tabular-nums text-ink-subtle">{row.previous ? formatCount(row.previous.clicks) : "—"}</TD>
                      </TR>
                    );
                  })
                )}
              </TBody>
            </Table>
          </TableWrap>
          <div className="mt-3">
            <Pagination
              basePath="/admin/marketing/seo/performance"
              params={{ property: property.id, period: params.period, view: params.view, sort: params.sort, q: params.q }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              perPage={PAGE_SIZE}
            />
          </div>
        </>
      )}
    </>
  );
}
