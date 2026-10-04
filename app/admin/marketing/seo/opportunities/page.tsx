import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { keywordOpportunities } from "@/lib/services/seo-intel/keyword.service";
import { OPPORTUNITY_MIN_IMPRESSIONS, TARGET_POSITION } from "@/lib/seo-intel/engine/rankings";
import { Pagination } from "@/components/admin/pagination";
import { Card, CardBody, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../seo-header";
import { ActionForm } from "../action-form";
import { addKeywordsAction } from "../actions";
import { FilterLinks, PropertyPicker, Stat } from "../crawl-parts";
import { formatCount, formatRange } from "../overview-parts";
import { formatCtr } from "../keywords/keyword-parts";

export const metadata: Metadata = { title: "Keyword opportunities" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  property: z.string().max(40).optional().catch(undefined),
  band: z.enum(["near-top", "page-two"]).optional().catch(undefined),
  tracked: z.enum(["1"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
const PAGE_SIZE = 50;
const BAND_LABEL = { "near-top": "Positions 4–10", "page-two": "Positions 11–20" } as const;

export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/opportunities");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canManage = can(actor, "seo.intelligence.manage");
  const canConnect = can(actor, "seo.intelligence.connect");
  const description = `Queries close to the top: positions 4–10, and page two (11–20), with at least ${OPPORTUNITY_MIN_IMPRESSIONS} impressions in the last 28 days. The extra clicks are an estimate calculated from this website's own click-through rate at each position.`;

  if (!property) {
    return (
      <>
        <SeoHeader current="opportunities" title="Opportunities" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const result = await keywordOpportunities(actor, property.id, { band: params.band, trackedOnly: params.tracked === "1", page: params.page, perPage: PAGE_SIZE });
  const link = (overrides: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ property: property.id, band: params.band, tracked: params.tracked, ...overrides })) if (value) query.set(key, value);
    return `/admin/marketing/seo/opportunities?${query}` as Route;
  };
  const header = <SeoHeader current="opportunities" title="Opportunities" description={description} query={`?property=${property.id}`} canConnect={canConnect} />;

  if (!result.hasData) {
    return (
      <>
        {header}
        <PropertyPicker id="opp-property" properties={properties} current={property.id} />
        <Card>
          <CardBody className="text-sm text-ink-subtle">
            No Search Console data for this website yet.{" "}
            <Link href={`/admin/marketing/seo/properties/${property.id}/search-console`} className="text-navy-800 underline underline-offset-2">
              {property.gscSiteUrl ? "See its sync status" : "Connect Search Console"}
            </Link>
            .
          </CardBody>
        </Card>
      </>
    );
  }

  const target = (band: keyof typeof TARGET_POSITION) => result.curve[TARGET_POSITION[band]];
  const pct = (value: number | null | undefined) => (value === null || value === undefined ? "too little data" : `${(value * 100).toFixed(1)}%`);

  return (
    <>
      {header}
      <PropertyPicker id="opp-property" properties={properties} current={property.id} />
      <p className="mb-3 text-2xs text-ink-subtle">{formatRange(result.range)}</p>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Positions 4–10" value={formatCount(result.counts["near-top"])} note={`Aimed at position ${TARGET_POSITION["near-top"]}: this site's CTR there is ${pct(target("near-top"))}`} />
        <Stat label="Positions 11–20" value={formatCount(result.counts["page-two"])} note={`Aimed at position ${TARGET_POSITION["page-two"]}: this site's CTR there is ${pct(target("page-two"))}`} />
        <div className="rounded-lg border border-line bg-white px-4 py-3 text-2xs text-ink-muted">
          <p className="font-medium uppercase tracking-wide text-ink-subtle">How the estimate works</p>
          <p className="mt-1">
            Extra clicks = impressions × (this site&apos;s CTR at the target position − the query&apos;s CTR now). Calculated by Emporia, not reported by Google; no estimate where the site has too little data at the target.
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <FilterLinks
          label="Band"
          items={[
            { key: "all", label: "Both", href: link({ band: undefined, page: undefined }), current: !params.band, count: result.counts["near-top"] + result.counts["page-two"] },
            ...(["near-top", "page-two"] as const).map((band) => ({ key: band, label: BAND_LABEL[band], href: link({ band, page: undefined }), current: params.band === band, count: result.counts[band] })),
          ]}
        />
        <FilterLinks
          label="Tracking"
          items={[
            { key: "any", label: "All queries", href: link({ tracked: undefined, page: undefined }), current: !params.tracked },
            { key: "tracked", label: "Tracked only", href: link({ tracked: "1", page: undefined }), current: params.tracked === "1" },
          ]}
        />
      </div>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Query</TH>
              <TH className="text-right">Position</TH>
              <TH className="text-right">Impressions</TH>
              <TH className="text-right">Clicks</TH>
              <TH className="text-right">CTR</TH>
              <TH className="text-right">Extra clicks (est.)</TH>
              <TH className="text-right">
                <span className="sr-only">Tracking</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {result.list.rows.length === 0 ? (
              <TableEmpty colSpan={7} title="No opportunities in this view." />
            ) : (
              result.list.rows.map((row) => (
                <TR key={row.query}>
                  <TD className="max-w-[22rem]">
                    {row.trackedId ? (
                      <Link href={`/admin/marketing/seo/keywords/${row.trackedId}?property=${property.id}` as Route} className="block truncate text-sm text-navy-800 hover:text-brand-red">
                        {row.query}
                      </Link>
                    ) : (
                      <span className="block truncate text-sm text-navy-800" title={row.query}>
                        {row.query}
                      </span>
                    )}
                    <span className="text-2xs text-ink-subtle">{BAND_LABEL[row.band]}</span>
                  </TD>
                  <TD className="text-right tabular-nums">{row.position.toFixed(1)}</TD>
                  <TD className="text-right tabular-nums">{formatCount(row.impressions)}</TD>
                  <TD className="text-right tabular-nums text-ink-muted">{formatCount(row.clicks)}</TD>
                  <TD className="text-right tabular-nums text-ink-muted">{formatCtr(row.clicks, row.impressions)}</TD>
                  <TD className="text-right tabular-nums">{row.extraClicks === null ? <span className="text-2xs text-ink-subtle">no estimate</span> : `+${formatCount(row.extraClicks)}`}</TD>
                  <TD className="text-right">
                    {row.trackedId ? (
                      <span className="text-2xs text-ink-subtle">Tracked</span>
                    ) : canManage ? (
                      <ActionForm action={addKeywordsAction} label="Track" variant="secondary" hidden={{ propertyId: property.id, keywords: row.query, source: "SEARCH_CONSOLE" }} className="flex justify-end" />
                    ) : null}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
      <div className="mt-3">
        <Pagination basePath="/admin/marketing/seo/opportunities" params={{ property: property.id, band: params.band, tracked: params.tracked }} page={result.list.page} pages={result.list.pages} total={result.list.total} perPage={PAGE_SIZE} />
      </div>

      <details className="mt-5 rounded-lg border border-line bg-white px-4 py-3">
        <summary className="cursor-pointer text-xs font-medium text-navy-800">This website&apos;s click-through rate by position</summary>
        <p className="mt-2 text-2xs text-ink-subtle">
          Clicks ÷ impressions of every query whose average position rounds to that position, last 28 days. Positions with under 200 impressions are left out; lower positions are capped at the rate above them.
        </p>
        <table className="mt-2 w-full max-w-md text-2xs">
          <thead>
            <tr className="text-left text-ink-subtle">
              <th className="py-0.5 font-medium">Position</th>
              <th className="py-0.5 text-right font-medium">CTR</th>
            </tr>
          </thead>
          <tbody>
            {result.curve.slice(1).map((value, index) => (
              <tr key={index} className="border-t border-line">
                <td className="py-0.5">{index + 1}</td>
                <td className="py-0.5 text-right tabular-nums">{pct(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
