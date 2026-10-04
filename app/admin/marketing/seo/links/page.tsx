import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { linkExtremes, listLinkSuggestions } from "@/lib/services/seo-intel/links.service";
import { Pagination } from "@/components/admin/pagination";
import { Card, CardBody, CardHeader, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../seo-header";
import { DATE_TIME, PropertyPicker, Stat, UrlCell } from "../crawl-parts";
import { formatCount } from "../overview-parts";

export const metadata: Metadata = { title: "Internal links" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  property: z.string().max(40).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
const PAGE_SIZE = 20;

export default async function InternalLinksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/links");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const description =
    "Links worth adding: pages that rank 4–20 for a query, and other pages on the website that already mention that query but do not link to them. Use the query as the link text. Made when a crawl finishes.";

  if (!property) {
    return (
      <>
        <SeoHeader current="links" title="Internal links" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const [suggestions, extremes] = await Promise.all([listLinkSuggestions(actor, property.id, { page: params.page, perPage: PAGE_SIZE }), linkExtremes(actor, property.id)]);
  const run = suggestions.run;

  return (
    <>
      <SeoHeader current="links" title="Internal links" description={description} query={`?property=${property.id}`} canConnect={canConnect} />
      <PropertyPicker id="links-property" properties={properties} current={property.id} />

      {!run ? (
        <Card className="mb-5">
          <CardBody className="text-sm text-ink-subtle">
            No finished crawl for this website yet.{" "}
            <Link href={`/admin/marketing/seo/crawl?property=${property.id}`} className="text-navy-800 underline underline-offset-2">
              Crawl it
            </Link>
            .
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Stat label="Suggestions" value={run.suggestionCount === null ? "—" : formatCount(run.suggestionCount)} note={`From the crawl of ${run.finishedAt ? DATE_TIME.format(run.finishedAt) : "—"}`} />
            <Stat label="Pages to link to" value={formatCount(suggestions.list.total)} note="Page and query pairs" />
            <Stat label="Pages crawled" value={formatCount(run.pagesFetched)} note="Text read once, then deleted" />
          </div>
          {run.suggestionCount === null ? (
            <p role="status" className="mb-5 rounded-md border border-line bg-white px-3.5 py-2.5 text-xs text-ink-muted">
              Suggestions need Search Console data to know which pages are close to the top for which queries.{" "}
              <Link href={`/admin/marketing/seo/properties/${property.id}/search-console`} className="text-navy-800 underline underline-offset-2">
                {property.gscSiteUrl ? "See its sync status" : "Connect Search Console"}
              </Link>
              , then crawl again.
            </p>
          ) : null}

          <div className="mb-6 space-y-4">
            {suggestions.list.rows.length === 0 && run.suggestionCount !== null ? (
              <Card>
                <CardBody className="text-sm text-ink-subtle">No pages to suggest links for in this crawl: no page that ranks 4–20 is mentioned unlinked elsewhere on the website.</CardBody>
              </Card>
            ) : null}
            {suggestions.list.rows.map((group) => (
              <Card key={`${group.target}-${group.query}`}>
                <CardHeader>
                  <p className="text-2xs uppercase tracking-wide text-ink-subtle">Link to</p>
                  <UrlCell url={group.target} />
                  <p className="mt-1 text-xs text-ink-muted">
                    with the text <span className="font-medium text-navy-800">“{group.query}”</span> — it ranks {group.position.toFixed(1)} for it, {formatCount(group.impressions)} impressions in 28 days
                  </p>
                </CardHeader>
                <CardBody>
                  <p className="mb-1.5 text-2xs uppercase tracking-wide text-ink-subtle">From</p>
                  <ul className="divide-y divide-line">
                    {group.sources.map((source) => (
                      <li key={source.url} className="py-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="min-w-0 max-w-full flex-1">
                            <UrlCell url={source.url} />
                          </span>
                          <span className="text-2xs tabular-nums text-ink-subtle">{formatCount(source.clicks)} clicks in 28 days</span>
                        </div>
                        <p className="mt-0.5 break-words text-xs text-ink-muted">{source.snippet}</p>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ))}
          </div>
          <Pagination basePath="/admin/marketing/seo/links" params={{ property: property.id }} page={suggestions.list.page} pages={suggestions.list.pages} total={suggestions.list.total} perPage={PAGE_SIZE} />

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            {(
              [
                ["Most linked pages", extremes.most],
                ["Least linked pages", extremes.least],
              ] as const
            ).map(([title, rows]) => (
              <div key={title} className="min-w-0">
                <h2 className="mb-2 text-base text-navy-800">{title}</h2>
                <TableWrap>
                  <Table>
                    <THead>
                      <TR>
                        <TH>Page</TH>
                        <TH className="text-right">Inlinks</TH>
                        <TH className="text-right">Depth</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {rows.length === 0 ? (
                        <TableEmpty colSpan={3} title="No indexable pages." />
                      ) : (
                        rows.map((row) => (
                          <TR key={row.url}>
                            <TD className="max-w-[18rem]">
                              <UrlCell url={row.url} />
                              {row.title ? <span className="block truncate text-2xs text-ink-subtle">{row.title}</span> : null}
                            </TD>
                            <TD className="text-right tabular-nums">{row.inlinks}</TD>
                            <TD className="text-right tabular-nums text-ink-muted">{row.depth < 0 ? "sitemap" : row.depth}</TD>
                          </TR>
                        ))
                      )}
                    </TBody>
                  </Table>
                </TableWrap>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
