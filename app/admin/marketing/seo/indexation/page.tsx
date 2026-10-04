import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { indexationOverview, listIndexation } from "@/lib/services/seo-intel/indexation.service";
import { BUCKET_LABEL, CONFLICT_LABEL, type Conflict, type IndexBucket } from "@/lib/seo-intel/engine/indexation";
import { Pagination } from "@/components/admin/pagination";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../seo-header";
import { ActionForm } from "../action-form";
import { inspectUrlAction } from "../actions";
import { DATE_TIME, FilterLinks, PropertyPicker, Stat, UrlCell } from "../crawl-parts";
import { formatCount } from "../overview-parts";

export const metadata: Metadata = { title: "Indexation" };
export const dynamic = "force-dynamic";

const BUCKETS = ["indexed", "not-indexed", "unknown-to-google", "error", "not-inspected"] as const satisfies readonly IndexBucket[];
const CONFLICTS = ["indexable-not-indexed", "not-indexable-but-indexed", "canonical-mismatch"] as const satisfies readonly Conflict[];

const paramsSchema = z.object({
  property: z.string().max(40).optional().catch(undefined),
  bucket: z.enum(BUCKETS).optional().catch(undefined),
  conflict: z.enum(CONFLICTS).optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

const PAGE_SIZE = 50;

const BUCKET_TONE: Record<IndexBucket, "success" | "red" | "warning" | "neutral"> = {
  indexed: "success",
  "not-indexed": "red",
  "unknown-to-google": "warning",
  error: "neutral",
  "not-inspected": "neutral",
};

export default async function IndexationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/indexation");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));

  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const canManage = can(actor, "seo.intelligence.manage");
  const description =
    "Google's own status for the website's pages, from Search Console's URL Inspection, beside what the crawl found. Google allows a limited number of inspections a day, so pages are inspected a batch at a time, sitemap pages first.";

  if (!property) {
    return (
      <>
        <SeoHeader current="indexation" title="Indexation" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const overview = await indexationOverview(actor, property.id);
  const header = <SeoHeader current="indexation" title="Indexation" description={description} query={`?property=${property.id}`} canConnect={canConnect} />;

  if (!overview.hasCrawl || !overview.connected) {
    return (
      <>
        {header}
        <PropertyPicker id="index-property" properties={properties} current={property.id} />
        <Card>
          <CardBody className="space-y-2 text-sm text-ink-subtle">
            {!overview.connected ? (
              <p>
                Indexation needs Search Console.{" "}
                <Link href={`/admin/marketing/seo/properties/${property.id}/search-console`} className="text-navy-800 underline underline-offset-2">
                  Connect it for this website
                </Link>
                .
              </p>
            ) : null}
            {!overview.hasCrawl ? (
              <p>
                It also needs a finished crawl, which supplies the pages to ask about.{" "}
                <Link href={`/admin/marketing/seo/crawl?property=${property.id}`} className="text-navy-800 underline underline-offset-2">
                  Crawl the website
                </Link>
                .
              </p>
            ) : null}
          </CardBody>
        </Card>
      </>
    );
  }

  const list = await listIndexation(actor, property.id, { bucket: params.bucket, conflict: params.conflict, q: params.q, page: params.page, perPage: PAGE_SIZE });
  const link = (overrides: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = { property: property.id, bucket: params.bucket, conflict: params.conflict, q: params.q, ...overrides };
    for (const [key, value] of Object.entries(merged)) if (value) query.set(key, value);
    return `/admin/marketing/seo/indexation?${query}` as Route;
  };

  return (
    <>
      {header}
      <PropertyPicker id="index-property" properties={properties} current={property.id} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="HTML pages" value={formatCount(overview.pages)} note={`From the crawl: ${formatCount(overview.indexable)} indexable · ${formatCount(overview.inSitemap)} in the sitemap`} />
        <Stat label="Inspected" value={`${formatCount(overview.inspected)} of ${formatCount(overview.pages)}`} note={`${overview.usedToday} of ${overview.dailyLimit} inspections used in the last 24 hours`} />
        <Stat label="Indexed by Google" value={formatCount(overview.buckets.indexed)} note="Of the pages inspected" />
        <Stat label="Not indexed" value={formatCount(overview.buckets["not-indexed"] + overview.buckets["unknown-to-google"])} note={`${overview.buckets["unknown-to-google"]} unknown to Google`} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Where the crawl and Google disagree</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-line">
              {CONFLICTS.map((conflict) => (
                <li key={conflict} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={link({ conflict, bucket: undefined, page: undefined })} className="text-navy-800 hover:text-brand-red">
                    {CONFLICT_LABEL[conflict]}
                  </Link>
                  <span className="tabular-nums">{formatCount(overview.conflicts[conflict])}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Google&apos;s coverage states</CardTitle>
          </CardHeader>
          <CardBody>
            {overview.coverage.length === 0 ? (
              <p className="text-xs text-ink-subtle">Nothing inspected yet. Inspections run with the scheduler, a batch at a time.</p>
            ) : (
              <ul className="divide-y divide-line">
                {overview.coverage.slice(0, 8).map((row) => (
                  <li key={row.state} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-ink">{row.state}</span>
                    <span className="tabular-nums">{formatCount(row.count)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <FilterLinks
          label="Index status"
          items={[
            { key: "all", label: "All", href: link({ bucket: undefined, conflict: undefined, page: undefined }), current: !params.bucket && !params.conflict, count: overview.pages },
            ...BUCKETS.map((bucket) => ({ key: bucket, label: BUCKET_LABEL[bucket], href: link({ bucket, conflict: undefined, page: undefined }), current: params.bucket === bucket, count: overview.buckets[bucket] })),
          ]}
        />
        <form className="flex gap-2">
          <input type="hidden" name="property" value={property.id} />
          {params.bucket ? <input type="hidden" name="bucket" value={params.bucket} /> : null}
          {params.conflict ? <input type="hidden" name="conflict" value={params.conflict} /> : null}
          <label htmlFor="index-q" className="sr-only">
            Search URLs
          </label>
          <Input id="index-q" name="q" defaultValue={params.q} placeholder="Part of a URL" className="w-56" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>
      {params.conflict ? (
        <p role="status" className="mb-3 text-xs text-ink-muted">
          Showing: {CONFLICT_LABEL[params.conflict]}.{" "}
          <Link href={link({ conflict: undefined, page: undefined })} className="text-navy-800 underline underline-offset-2">
            Show all
          </Link>
        </p>
      ) : null}

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>URL</TH>
              <TH>Crawl</TH>
              <TH>Google</TH>
              <TH>Last Google crawl</TH>
              <TH>Inspected</TH>
              {canManage ? <TH className="text-right">
                <span className="sr-only">Actions</span>
              </TH> : null}
            </TR>
          </THead>
          <TBody>
            {list.rows.length === 0 ? (
              <TableEmpty colSpan={canManage ? 6 : 5} title="Nothing matches." />
            ) : (
              list.rows.map((row) => (
                <TR key={row.url}>
                  <TD className="max-w-[22rem]">
                    <UrlCell url={row.url} />
                    {row.conflicts.map((conflict) => (
                      <span key={conflict} className="block text-2xs text-brand-red-text">
                        {CONFLICT_LABEL[conflict]}
                      </span>
                    ))}
                    {row.conflicts.includes("canonical-mismatch") && row.googleCanonical ? (
                      <span className="block truncate text-2xs text-ink-subtle" title={row.googleCanonical}>
                        Google&apos;s choice: {row.googleCanonical}
                      </span>
                    ) : null}
                  </TD>
                  <TD className="text-xs">
                    {row.indexable ? <span className="text-success">Indexable</span> : <span className="text-ink-muted">Not indexable</span>}
                    {row.inSitemap ? <span className="block text-2xs text-ink-subtle">in sitemap</span> : null}
                  </TD>
                  <TD className="max-w-[16rem] text-xs">
                    <Badge tone={BUCKET_TONE[row.bucket]}>{BUCKET_LABEL[row.bucket]}</Badge>
                    {row.coverageState ? <span className="mt-0.5 block text-2xs text-ink-subtle">{row.coverageState}</span> : null}
                    {row.error ? <span className="mt-0.5 block truncate text-2xs text-brand-red-text" title={row.error}>{row.error}</span> : null}
                  </TD>
                  <TD className="text-2xs text-ink-subtle">{row.lastCrawlTime ? DATE_TIME.format(row.lastCrawlTime) : "—"}</TD>
                  <TD className="text-2xs text-ink-subtle">{row.inspectedAt ? DATE_TIME.format(row.inspectedAt) : "—"}</TD>
                  {canManage ? (
                    <TD className="text-right">
                      <ActionForm action={inspectUrlAction} label="Inspect" pendingLabel="Asking Google…" variant="secondary" hidden={{ propertyId: property.id, url: row.url }} className="flex justify-end" />
                    </TD>
                  ) : null}
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
      <div className="mt-3">
        <Pagination basePath="/admin/marketing/seo/indexation" params={{ property: property.id, bucket: params.bucket, conflict: params.conflict, q: params.q }} page={list.page} pages={list.pages} total={list.total} perPage={PAGE_SIZE} />
      </div>
      {overview.crawledAt ? <p className="mt-3 text-2xs text-ink-subtle">Pages from the crawl finished {DATE_TIME.format(overview.crawledAt)}.</p> : null}
    </>
  );
}
