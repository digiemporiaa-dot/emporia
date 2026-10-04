import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { getCrawlRun, listCrawlPages, listCrawlRuns, PAGE_FILTERS, type PageFilter } from "@/lib/services/seo-intel/crawl.service";
import { Pagination } from "@/components/admin/pagination";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../seo-header";
import { ActionForm } from "../action-form";
import { cancelCrawlAction, startCrawlAction } from "../actions";
import { AutoRefresh } from "../auto-refresh";
import { DATE_TIME, FilterLinks, PropertyPicker, RunBadge, Stat, UrlCell } from "../crawl-parts";
import { formatCount } from "../overview-parts";

export const metadata: Metadata = { title: "Site crawl" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  property: z.string().max(40).optional().catch(undefined),
  run: z.string().max(40).optional().catch(undefined),
  filter: z.enum(PAGE_FILTERS).catch("all"),
  q: z.string().trim().max(200).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

const PAGE_SIZE = 50;

const FILTER_LABEL: Record<PageFilter, string> = {
  all: "All",
  html: "HTML pages",
  indexable: "Indexable",
  "non-indexable": "Not indexable",
  "2xx": "2xx",
  "3xx": "Redirects",
  "4xx": "4xx",
  "5xx": "5xx",
  error: "Failed",
  blocked: "Blocked",
  queued: "Queued",
};

function statusTone(code: number | null): "success" | "warning" | "red" | "neutral" {
  if (code === null) return "neutral";
  if (code < 300) return "success";
  if (code < 400) return "warning";
  return "red";
}

export default async function SiteCrawlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/crawl");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));

  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const canManage = can(actor, "seo.intelligence.manage");
  const description = "Every page the crawler reached on the website: status, indexability, sitemap membership and internal links. It reads the HTML the server sends; content built by JavaScript in the browser is not seen.";

  if (!property) {
    return (
      <>
        <SeoHeader current="crawl" title="Site crawl" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const [runs, run] = await Promise.all([listCrawlRuns(actor, property.id), getCrawlRun(actor, property.id, params.run)]);
  const pages = run ? await listCrawlPages(actor, run.id, { filter: params.filter, q: params.q, page: params.page, perPage: PAGE_SIZE }) : null;
  const link = (overrides: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = { property: property.id, run: params.run, filter: params.filter === "all" ? undefined : params.filter, q: params.q, ...overrides };
    for (const [key, value] of Object.entries(merged)) if (value) query.set(key, value);
    return `/admin/marketing/seo/crawl?${query}` as Route;
  };
  const running = run?.status === "RUNNING";

  return (
    <>
      <SeoHeader current="crawl" title="Site crawl" description={description} query={`?property=${property.id}`} canConnect={canConnect} />
      {running ? <AutoRefresh /> : null}
      <PropertyPicker id="crawl-property" properties={properties} current={property.id} />

      <Card className="mb-5">
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {run ? "Crawl" : "No crawl yet"}
              {run ? <RunBadge status={run.status} /> : null}
            </CardTitle>
            <p className="mt-1 text-xs text-ink-subtle">
              {run
                ? `${run.trigger === "SCHEDULED" ? "Scheduled" : `Started by ${run.startedBy?.name ?? "staff"}`} · ${DATE_TIME.format(run.startedAt)}${run.finishedAt ? ` · finished ${DATE_TIME.format(run.finishedAt)}` : ""}`
                : property.crawlFrequency === "WEEKLY"
                  ? "The first weekly crawl starts on the next scheduler run, or crawl now."
                  : "This website is crawled only on demand."}
            </p>
          </div>
          {canManage ? (
            running && run ? (
              <ActionForm action={cancelCrawlAction} label="Cancel crawl" variant="secondary" hidden={{ propertyId: property.id, runId: run.id }} confirm="Stop this crawl? Pages fetched so far are kept but not analysed." />
            ) : (
              <ActionForm action={startCrawlAction} label="Crawl now" pendingLabel="Starting…" hidden={{ propertyId: property.id }} />
            )
          ) : null}
        </CardHeader>
        {run ? (
          <CardBody>
            {run.error ? (
              <p role="alert" className="mb-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-brand-red-text">
                {run.error}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label="Pages fetched"
                value={formatCount(run.pagesFetched)}
                note={running ? `${formatCount(run.queued)} still queued · limit ${formatCount(run.maxPages)}` : `limit ${formatCount(run.maxPages)}${run.limitReached ? " — reached" : ""}`}
              />
              <Stat label="Sitemap URLs" value={formatCount(run.sitemapUrls)} note={run.sitemaps.length ? `${run.sitemaps.length} sitemap file${run.sitemaps.length === 1 ? "" : "s"} read` : "No sitemap found"} />
              <Stat label="robots.txt" value={run.robotsFound === null ? "—" : run.robotsFound ? "Found" : "None"} note={run.robotsFound ? "Obeyed by the crawler" : "Everything allowed"} />
              <Stat
                label="Findings"
                value={run.summary ? formatCount(Object.values(run.summary as Record<string, number>).reduce((a, b) => a + b, 0)) : running ? "…" : "—"}
                note={run.summary ? `${(run.summary as Record<string, number>)["CRITICAL"] ?? 0} critical · ${(run.summary as Record<string, number>)["WARNING"] ?? 0} warnings` : running ? "Analysed when the crawl finishes" : undefined}
              />
            </div>
            {run.limitReached ? (
              <p className="mt-3 text-xs text-ink-muted">
                The page limit stopped this crawl before the whole site was covered. Raise “Pages per crawl” on the{" "}
                <Link href={`/admin/marketing/seo/properties/${property.id}`} className="text-navy-800 underline underline-offset-2">
                  website
                </Link>{" "}
                to crawl more.
              </p>
            ) : null}
            {run.status === "SUCCEEDED" ? (
              <p className="mt-3 text-xs">
                <Link href={`/admin/marketing/seo/technical?property=${property.id}&run=${run.id}`} className="text-navy-800 underline underline-offset-2">
                  See the technical findings
                </Link>
              </p>
            ) : null}
          </CardBody>
        ) : null}
      </Card>

      {runs.length > 1 ? (
        <nav aria-label="Recent crawls" className="mb-4 flex flex-wrap items-center gap-1 text-xs">
          <span className="mr-1 text-ink-subtle">Recent crawls:</span>
          {runs.map((item) => (
            <Link
              key={item.id}
              href={link({ run: item.id, page: undefined })}
              aria-current={item.id === run?.id ? "page" : undefined}
              className={item.id === run?.id ? "rounded-md bg-navy-800 px-2 py-1 font-medium text-white" : "rounded-md border border-line bg-white px-2 py-1 text-ink-muted hover:text-navy-800"}
            >
              {DATE_TIME.format(item.startedAt)}
              {item.status !== "SUCCEEDED" ? ` · ${item.status.toLowerCase()}` : ""}
            </Link>
          ))}
        </nav>
      ) : null}

      {run && pages ? (
        <>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <FilterLinks
              label="Page filter"
              items={PAGE_FILTERS.map((key) => ({ key, label: FILTER_LABEL[key], href: link({ filter: key === "all" ? undefined : key, page: undefined }), current: key === params.filter }))}
            />
            <form className="flex gap-2">
              <input type="hidden" name="property" value={property.id} />
              {params.run ? <input type="hidden" name="run" value={params.run} /> : null}
              {params.filter !== "all" ? <input type="hidden" name="filter" value={params.filter} /> : null}
              <label htmlFor="crawl-q" className="sr-only">
                Search URLs
              </label>
              <Input id="crawl-q" name="q" defaultValue={params.q} placeholder="Part of a URL" className="w-56" />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
          </div>

          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>URL</TH>
                  <TH>Status</TH>
                  <TH>Title</TH>
                  <TH className="text-right">Words</TH>
                  <TH className="text-right">Depth</TH>
                  <TH className="text-right">Inlinks</TH>
                  <TH>Index</TH>
                  <TH className="text-right">Findings</TH>
                </TR>
              </THead>
              <TBody>
                {pages.rows.length === 0 ? (
                  <TableEmpty colSpan={8} title={params.q || params.filter !== "all" ? "Nothing matches." : "No pages yet."} />
                ) : (
                  pages.rows.map((row) => (
                    <TR key={row.id}>
                      <TD className="max-w-[18rem]">
                        <UrlCell url={row.url} />
                        {row.redirectTo ? <span className="block truncate text-2xs text-ink-subtle" title={row.redirectTo}>→ {row.redirectTo}</span> : null}
                        {row.error ? <span className="block truncate text-2xs text-brand-red-text" title={row.error}>{row.error}</span> : null}
                      </TD>
                      <TD className="whitespace-nowrap">
                        {row.state === "FETCHED" ? (
                          <Badge tone={statusTone(row.statusCode)}>{row.statusCode}</Badge>
                        ) : (
                          <Badge tone={row.state === "ERROR" ? "red" : "neutral"}>{row.state === "BLOCKED" ? "Blocked" : row.state === "ERROR" ? "Failed" : "Queued"}</Badge>
                        )}
                        {row.responseMs !== null ? <span className="ml-1 text-2xs tabular-nums text-ink-subtle">{row.responseMs} ms</span> : null}
                      </TD>
                      <TD className="max-w-[16rem]">
                        <span className="block truncate text-xs text-navy-800" title={row.title ?? undefined}>
                          {row.title ?? <span className="text-ink-subtle">—</span>}
                        </span>
                      </TD>
                      <TD className="text-right tabular-nums text-ink-muted">{row.wordCount ?? "—"}</TD>
                      <TD className="text-right tabular-nums text-ink-muted">{row.depth < 0 ? <span title="Found only in the sitemap">sitemap</span> : row.depth}</TD>
                      <TD className="text-right tabular-nums text-ink-muted">{row.inlinks}</TD>
                      <TD className="text-xs">
                        {row.indexable === null ? "—" : row.indexable ? <span className="text-success">Indexable</span> : <span className="text-ink-muted">{/noindex|none/i.test(row.metaRobots ?? "") ? "Noindex" : row.canonical && row.canonical !== row.url ? "Canonicalised" : "No"}</span>}
                        {row.inSitemap ? <span className="ml-1 text-2xs text-ink-subtle">· in sitemap</span> : null}
                      </TD>
                      <TD className="text-right tabular-nums">{row._count.issues || <span className="text-ink-subtle">0</span>}</TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>
          <div className="mt-3">
            <Pagination
              basePath="/admin/marketing/seo/crawl"
              params={{ property: property.id, run: params.run, filter: params.filter === "all" ? undefined : params.filter, q: params.q }}
              page={pages.page}
              pages={pages.pages}
              total={pages.total}
              perPage={PAGE_SIZE}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
