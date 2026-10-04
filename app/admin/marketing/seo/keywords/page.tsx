import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { KEYWORD_FILTERS, KEYWORD_PERIODS, KEYWORD_SORTS, listKeywords, type KeywordFilter, type KeywordSort } from "@/lib/services/seo-intel/keyword.service";
import { Pagination } from "@/components/admin/pagination";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { SeoHeader } from "../seo-header";
import { ActionForm } from "../action-form";
import { addKeywordsAction, removeKeywordsAction } from "../actions";
import { FilterLinks, PropertyPicker, Stat, UrlCell } from "../crawl-parts";
import { formatCount, formatRange } from "../overview-parts";
import { BandNote, ChangeCell, formatCtr, formatPos } from "./keyword-parts";

export const metadata: Metadata = { title: "Keywords" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  property: z.string().max(40).optional().catch(undefined),
  period: z.enum(KEYWORD_PERIODS).catch("28d"),
  filter: z.enum(KEYWORD_FILTERS).catch("all"),
  sort: z.enum(KEYWORD_SORTS).catch("position"),
  tag: z.string().trim().max(40).optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

const PAGE_SIZE = 50;

const FILTER_LABEL: Record<KeywordFilter, string> = {
  all: "All",
  improved: "Improved",
  declined: "Declined",
  "entered-top10": "Entered top 10",
  "left-top10": "Left top 10",
  top3: "Top 3",
  top10: "Top 10",
  top20: "Top 20",
  "not-ranking": "No impressions",
};

const SORT_LABEL: Record<KeywordSort, string> = { position: "Position", change: "Change", clicks: "Clicks", impressions: "Impressions", keyword: "Keyword" };

export default async function KeywordsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/keywords");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));

  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const canManage = can(actor, "seo.intelligence.manage");
  const description =
    "Keywords the agency tracks for a website. Positions are Search Console's average position for the query — real data from Google, not a rank checked by a tool — compared with the previous period.";

  if (!property) {
    return (
      <>
        <SeoHeader current="keywords" title="Keywords" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const result = await listKeywords(actor, property.id, { period: params.period, filter: params.filter, sort: params.sort, tag: params.tag, q: params.q, page: params.page, perPage: PAGE_SIZE });
  const link = (overrides: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = {
      property: property.id,
      period: params.period === "28d" ? undefined : params.period,
      filter: params.filter === "all" ? undefined : params.filter,
      sort: params.sort === "position" ? undefined : params.sort,
      tag: params.tag,
      q: params.q,
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) if (value) query.set(key, value);
    return `/admin/marketing/seo/keywords?${query}` as Route;
  };

  const table = (
    <TableWrap>
      <Table>
        <THead>
          <TR>
            {canManage ? (
              <TH className="w-8">
                <span className="sr-only">Select</span>
              </TH>
            ) : null}
            <TH>Keyword</TH>
            <TH className="text-right">Position</TH>
            <TH className="text-right">Change</TH>
            <TH className="text-right">Clicks</TH>
            <TH className="text-right">Impressions</TH>
            <TH className="text-right">CTR</TH>
            <TH>Ranking page</TH>
          </TR>
        </THead>
        <TBody>
          {result.list.rows.length === 0 ? (
            <TableEmpty
              colSpan={canManage ? 8 : 7}
              title={result.tracked === 0 ? "No keywords tracked yet." : "Nothing matches."}
              description={result.tracked === 0 ? "Add keywords below, or pick them from Search Console suggestions." : undefined}
            />
          ) : (
            result.list.rows.map((row) => (
              <TR key={row.id}>
                {canManage ? (
                  <TD>
                    <input type="checkbox" name="keywordIds" value={row.id} aria-label={`Select ${row.keyword}`} className="size-4 accent-navy-800" />
                  </TD>
                ) : null}
                <TD className="max-w-[18rem]">
                  <Link href={`/admin/marketing/seo/keywords/${row.id}?property=${property.id}` as Route} className="block truncate text-sm text-navy-800 hover:text-brand-red">
                    {row.keyword}
                  </Link>
                  {row.tags.length ? (
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {row.tags.map((tag) => (
                        <Link key={tag} href={link({ tag, page: undefined })} className="rounded bg-surface-sunken px-1.5 text-2xs text-ink-muted hover:text-navy-800">
                          {tag}
                        </Link>
                      ))}
                    </span>
                  ) : null}
                </TD>
                <TD className="text-right tabular-nums">
                  {formatPos(row.current.position, row.current.impressions)}
                  <BandNote movement={row.movement} />
                </TD>
                <TD className="text-right">
                  <ChangeCell movement={row.movement} />
                </TD>
                <TD className="text-right tabular-nums">{formatCount(row.current.clicks)}</TD>
                <TD className="text-right tabular-nums text-ink-muted">{formatCount(row.current.impressions)}</TD>
                <TD className="text-right tabular-nums text-ink-muted">{formatCtr(row.current.clicks, row.current.impressions)}</TD>
                <TD className="max-w-[16rem]">{row.page ? <UrlCell url={row.page} /> : <span className="text-ink-subtle">—</span>}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </TableWrap>
  );

  return (
    <>
      <SeoHeader current="keywords" title="Keywords" description={description} query={`?property=${property.id}`} canConnect={canConnect} />
      <PropertyPicker id="kw-property" properties={properties} current={property.id} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tracked" value={`${formatCount(result.tracked)} of ${formatCount(result.cap)}`} note="Keywords tracked for this website" />
        <Stat label="In the top 3" value={formatCount(result.counts.top3)} note={`${formatCount(result.counts.top10)} in the top 10`} />
        <Stat label="Improved" value={formatCount(result.counts.improved)} note={`${formatCount(result.counts["entered-top10"])} entered the top 10`} />
        <Stat label="Declined" value={formatCount(result.counts.declined)} note={`${formatCount(result.counts["left-top10"])} left the top 10`} />
      </div>

      {!result.hasData ? (
        <p role="status" className="mb-4 rounded-md border border-line bg-white px-3.5 py-2.5 text-xs text-ink-muted">
          No Search Console data for this website yet, so tracked keywords show no positions.{" "}
          <Link href={`/admin/marketing/seo/properties/${property.id}/search-console`} className="text-navy-800 underline underline-offset-2">
            {property.gscSiteUrl ? "See its sync status" : "Connect Search Console"}
          </Link>
          .
        </p>
      ) : (
        <p className="mb-3 text-2xs text-ink-subtle">
          {formatRange(result.period!.current)} vs {formatRange(result.period!.previous)} · positions are impression-weighted averages; moves under half a place count as steady
          {result.pairsSince ? ` · ranking pages from ${result.pairsSince}` : " · ranking pages appear after the next Search Console sync"}
          {" · "}
          <Link href={`/admin/marketing/seo/keywords/suggestions?property=${property.id}` as Route} className="text-navy-800 underline underline-offset-2">
            Search Console suggestions
          </Link>
        </p>
      )}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <FilterLinks
          label="Keyword filter"
          items={KEYWORD_FILTERS.map((key) => ({ key, label: FILTER_LABEL[key], href: link({ filter: key === "all" ? undefined : key, page: undefined }), current: key === params.filter, count: result.counts[key] }))}
        />
        <FilterLinks
          label="Period"
          items={KEYWORD_PERIODS.map((key) => ({ key, label: key === "7d" ? "7 days" : "28 days", href: link({ period: key === "28d" ? undefined : key, page: undefined }), current: key === params.period }))}
        />
      </div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <nav aria-label="Sort" className="flex flex-wrap items-center gap-1 text-xs">
          <span className="mr-1 text-ink-subtle">Sort:</span>
          {KEYWORD_SORTS.map((key) => (
            <Link key={key} href={link({ sort: key === "position" ? undefined : key, page: undefined })} aria-current={key === params.sort ? "true" : undefined} className={key === params.sort ? "font-semibold text-navy-800" : "text-ink-muted hover:text-navy-800"}>
              {SORT_LABEL[key]}
            </Link>
          ))}
          {params.tag ? (
            <span className="ml-3 inline-flex items-center gap-1">
              <Badge tone="navy">{params.tag}</Badge>
              <Link href={link({ tag: undefined, page: undefined })} className="text-2xs text-ink-muted underline underline-offset-2">
                clear tag
              </Link>
            </span>
          ) : result.tags.length ? (
            <span className="ml-3 text-ink-subtle">
              Tags:{" "}
              {result.tags.slice(0, 12).map((tag, index) => (
                <span key={tag}>
                  {index > 0 ? ", " : ""}
                  <Link href={link({ tag, page: undefined })} className="text-navy-800 hover:text-brand-red">
                    {tag}
                  </Link>
                </span>
              ))}
            </span>
          ) : null}
        </nav>
        <form className="flex gap-2">
          <input type="hidden" name="property" value={property.id} />
          {params.filter !== "all" ? <input type="hidden" name="filter" value={params.filter} /> : null}
          {params.tag ? <input type="hidden" name="tag" value={params.tag} /> : null}
          <label htmlFor="kw-q" className="sr-only">
            Search keywords
          </label>
          <Input id="kw-q" name="q" defaultValue={params.q} placeholder="Part of a keyword" className="w-52" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      {canManage ? (
        <ActionForm action={removeKeywordsAction} label="Untrack selected" variant="secondary" hidden={{ propertyId: property.id }} confirm="Stop tracking the selected keywords? Their Search Console history stays.">
          {table}
        </ActionForm>
      ) : (
        table
      )}
      <div className="mt-3">
        <Pagination
          basePath="/admin/marketing/seo/keywords"
          params={{ property: property.id, period: params.period === "28d" ? undefined : params.period, filter: params.filter === "all" ? undefined : params.filter, sort: params.sort === "position" ? undefined : params.sort, tag: params.tag, q: params.q }}
          page={result.list.page}
          pages={result.list.pages}
          total={result.list.total}
          perPage={PAGE_SIZE}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Track keywords</CardTitle>
            </CardHeader>
            <CardBody>
              <ActionForm action={addKeywordsAction} label="Track" pendingLabel="Adding…" hidden={{ propertyId: property.id, source: "MANUAL" }}>
                <Field id="kw-new" label="Keywords" hint="One per line, or separated by commas. Stored in lower case, the way Search Console reports queries.">
                  {(aria) => <Textarea {...aria} name="keywords" rows={4} maxLength={20_000} spellCheck={false} />}
                </Field>
                <Field id="kw-tags" label="Tags" hint="Optional, comma separated: a service, a city, a campaign.">
                  {(aria) => <Input {...aria} name="tags" maxLength={500} />}
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Exact rank and volume</CardTitle>
          </CardHeader>
          <CardBody className="text-xs text-ink-muted">
            {result.rankProvider
              ? `From ${result.rankProvider}.`
              : "No rank provider is configured, so exact daily rank, search volume, difficulty and CPC are not shown. Positions here are Search Console averages."}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
