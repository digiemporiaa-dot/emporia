import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { keywordSuggestions } from "@/lib/services/seo-intel/keyword.service";
import { Pagination } from "@/components/admin/pagination";
import { Button, Card, CardBody, Field, Input, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../../seo-header";
import { ActionForm } from "../../action-form";
import { addKeywordsAction } from "../../actions";
import { PropertyPicker } from "../../crawl-parts";
import { formatCount, formatRange } from "../../overview-parts";
import { formatCtr, formatPos } from "../keyword-parts";

export const metadata: Metadata = { title: "Keyword suggestions" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  property: z.string().max(40).optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
const PAGE_SIZE = 50;

/** Search Console queries not yet tracked, so staff choose what to track. */
export default async function KeywordSuggestionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/keywords/suggestions");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canManage = can(actor, "seo.intelligence.manage");
  const canConnect = can(actor, "seo.intelligence.connect");
  const description = "Queries Search Console reported for the website in the last 28 days that are not tracked yet, most impressions first. Tick the ones worth tracking.";

  if (!property) {
    return (
      <>
        <SeoHeader current="keywords" title="Keyword suggestions" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const result = await keywordSuggestions(actor, property.id, { q: params.q, page: params.page, perPage: PAGE_SIZE });
  const back = `/admin/marketing/seo/keywords?property=${property.id}` as Route;

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
            <TH>Query</TH>
            <TH className="text-right">Position</TH>
            <TH className="text-right">Clicks</TH>
            <TH className="text-right">Impressions</TH>
            <TH className="text-right">CTR</TH>
          </TR>
        </THead>
        <TBody>
          {result.list.rows.length === 0 ? (
            <TableEmpty colSpan={canManage ? 6 : 5} title={result.hasData ? (params.q ? "Nothing matches." : "Every reported query is already tracked.") : "No Search Console data for this website yet."} />
          ) : (
            result.list.rows.map((row) => (
              <TR key={row.query}>
                {canManage ? (
                  <TD>
                    <input type="checkbox" name="pick" value={row.query} aria-label={`Track ${row.query}`} className="size-4 accent-navy-800" />
                  </TD>
                ) : null}
                <TD className="max-w-[24rem]">
                  <span className="block truncate text-sm text-navy-800" title={row.query}>
                    {row.query}
                  </span>
                </TD>
                <TD className="text-right tabular-nums">{formatPos(row.position, row.impressions)}</TD>
                <TD className="text-right tabular-nums">{formatCount(row.clicks)}</TD>
                <TD className="text-right tabular-nums text-ink-muted">{formatCount(row.impressions)}</TD>
                <TD className="text-right tabular-nums text-ink-muted">{formatCtr(row.clicks, row.impressions)}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </TableWrap>
  );

  return (
    <>
      <SeoHeader current="keywords" title="Keyword suggestions" description={description} crumbs={[{ href: back, label: "Keywords" }, { label: "Suggestions" }]} query={`?property=${property.id}`} canConnect={canConnect} />
      <PropertyPicker id="sug-property" properties={properties} current={property.id} />
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <p className="text-2xs text-ink-subtle">{"range" in result && result.range ? `${formatRange(result.range)} · ${formatCount(result.list.total)} untracked queries` : ""}</p>
        <form className="flex gap-2">
          <input type="hidden" name="property" value={property.id} />
          <label htmlFor="sug-q" className="sr-only">
            Search queries
          </label>
          <Input id="sug-q" name="q" defaultValue={params.q} placeholder="Part of a query" className="w-52" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>
      {canManage ? (
        <ActionForm action={addKeywordsAction} label="Track selected" pendingLabel="Adding…" hidden={{ propertyId: property.id, source: "SEARCH_CONSOLE" }}>
          {table}
          <Card>
            <CardBody>
              <Field id="sug-tags" label="Tags for the selected keywords" hint="Optional, comma separated.">
                {(aria) => <Input {...aria} name="tags" maxLength={500} className="max-w-md" />}
              </Field>
            </CardBody>
          </Card>
        </ActionForm>
      ) : (
        table
      )}
      <div className="mt-3">
        <Pagination basePath="/admin/marketing/seo/keywords/suggestions" params={{ property: property.id, q: params.q }} page={result.list.page} pages={result.list.pages} total={result.list.total} perPage={PAGE_SIZE} />
      </div>
      <p className="mt-3 text-xs">
        <Link href={back} className="text-navy-800 underline underline-offset-2">
          Back to tracked keywords
        </Link>
      </p>
    </>
  );
}
