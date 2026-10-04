import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { CONTENT_TYPES, contentFindings } from "@/lib/services/seo-intel/content.service";
import type { ContentType, CrawlFacts, Finding } from "@/lib/seo-intel/engine/content";
import type { Thresholds } from "@/lib/seo-intel/thresholds";
import { Pagination } from "@/components/admin/pagination";
import { Card, CardBody, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { SeoHeader } from "../seo-header";
import { DATE_TIME, FilterLinks, PropertyPicker, UrlCell } from "../crawl-parts";
import { formatCount, formatRange } from "../overview-parts";

export const metadata: Metadata = { title: "Content" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  property: z.string().max(40).optional().catch(undefined),
  type: z.enum(CONTENT_TYPES).catch("decaying"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
const PAGE_SIZE = 50;

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const whole = (value: number) => `${Math.round(value * 100)}%`;

/** Labels and explanations, the numbers taken from this website's thresholds. */
function typeInfo(t: Thresholds): Record<ContentType, { label: string; why: string; impact: string }> {
  return {
    decaying: {
      label: "Decaying",
      why: `Clicks fell in each of the last three 28-day blocks, by ${whole(t["decay.minDrop"])} or more overall, from a page that had at least ${t["decay.minClicks"]} clicks a block.`,
      impact: "Clicks lost a block",
    },
    refresh: {
      label: "Needs a refresh",
      why: `Search demand held (impressions at least ${whole(t["refresh.impressionsHeld"])} of a first block with ${t["refresh.minImpressions"]}+) while the page slipped ${t["refresh.minSlip"]} or more places and did not recover — the usual sign of being overtaken.`,
      impact: "Clicks lost to the slip",
    },
    "low-ctr": {
      label: "Low CTR",
      why: `In the last 28 days the page earned under ${whole(t["lowCtr.share"])} of the click-through rate this website gets at the same position (${t["lowCtr.minImpressions"]}+ impressions). The title and description are usually the fix.`,
      impact: "Clicks missed",
    },
    potential: {
      label: "High potential",
      why: "Pages whose queries at positions 4–20 add up to the most extra clicks, each estimated from this website's own click-through rate by position.",
      impact: "Extra clicks (est.)",
    },
    cannibalisation: {
      label: "Possible cannibalisation",
      why: `Two or more of the website's pages each take ${whole(t["cannibal.minShare"])} or more of one query's impressions (${t["cannibal.minImpressions"]}+ in 28 days). Sometimes intended; often one page should be the answer.`,
      impact: "Impressions on the weaker pages",
    },
  };
}


function CrawlNote({ crawl }: { crawl: CrawlFacts | null }) {
  if (!crawl) return <span className="block text-2xs text-ink-subtle">Not in the latest crawl</span>;
  return (
    <span className="mt-0.5 block text-2xs text-ink-subtle">
      <span className="text-ink-muted">Title:</span> {crawl.title ?? "—"}
      {crawl.indexable === false ? <span className="text-brand-red-text"> · not indexable</span> : null}
    </span>
  );
}

function Evidence({ finding }: { finding: Finding }) {
  switch (finding.type) {
    case "decaying":
      return (
        <span className="tabular-nums">
          Clicks {finding.clicks.map(formatCount).join(" → ")} · down {pct(finding.drop)}
        </span>
      );
    case "refresh":
      return (
        <span className="tabular-nums">
          Position {finding.positions.map((p) => p.toFixed(1)).join(" → ")} · impressions {finding.impressions.map(formatCount).join(" → ")}
        </span>
      );
    case "low-ctr":
      return (
        <span className="tabular-nums">
          CTR {pct(finding.ctr)} at position {finding.position.toFixed(1)}; this site gets {pct(finding.expected)} there · {formatCount(finding.impressions)} impressions
          {finding.crawl?.description ? <span className="mt-0.5 block text-ink-subtle">Description: {finding.crawl.description}</span> : null}
        </span>
      );
    case "potential":
      return (
        <ul className="space-y-0.5">
          {finding.queries.map((q) => (
            <li key={q.query} className="tabular-nums">
              “{q.query}” — position {q.position.toFixed(1)}, {formatCount(q.impressions)} impressions, +{formatCount(q.extraClicks)} est.
            </li>
          ))}
        </ul>
      );
    case "cannibalisation":
      return (
        <ul className="space-y-0.5">
          {finding.pages.map((page) => (
            <li key={page.url} className="flex min-w-0 items-baseline gap-2 tabular-nums">
              <span className="shrink-0">{pct(page.share)} · pos {page.position.toFixed(1)} · {formatCount(page.clicks)} clicks</span>
              <span className="min-w-0 flex-1">
                <UrlCell url={page.url} />
              </span>
            </li>
          ))}
        </ul>
      );
  }
}

export default async function ContentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/content");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const description = "Pages that are losing ground, under-performing their position, close to more traffic, or competing with each other. Calculated by Emporia from Search Console and the latest crawl.";

  if (!property) {
    return (
      <>
        <SeoHeader current="content" title="Content" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const result = await contentFindings(actor, property.id, { type: params.type, page: params.page, perPage: PAGE_SIZE });
  const header = <SeoHeader current="content" title="Content" description={description} query={`?property=${property.id}`} canConnect={canConnect} />;
  if (!result.hasData) {
    return (
      <>
        {header}
        <PropertyPicker id="content-property" properties={properties} current={property.id} />
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

  const link = (type: ContentType) => `/admin/marketing/seo/content?property=${property.id}&type=${type}` as Route;
  const TYPE = typeInfo(result.thresholds);
  const meta = TYPE[params.type];
  const needsHistory = (params.type === "decaying" || params.type === "refresh") && !result.historyComplete;
  const needsPairs = (params.type === "potential" || params.type === "cannibalisation") && !result.pairsSince;

  return (
    <>
      {header}
      <PropertyPicker id="content-property" properties={properties} current={property.id} hidden={{ type: params.type }} />
      <p className="mb-3 text-2xs text-ink-subtle">
        Blocks: {result.blocks.map((block) => formatRange(block)).join(" · ")}
        {result.crawledAt ? ` · titles from the crawl of ${DATE_TIME.format(result.crawledAt)}` : " · no finished crawl, so titles are not shown"}
      </p>
      <div className="mb-3">
        <FilterLinks label="Finding" items={CONTENT_TYPES.map((type) => ({ key: type, label: TYPE[type].label, href: link(type), current: type === params.type, count: result.counts[type] }))} />
      </div>
      <p className="mb-3 max-w-3xl text-xs text-ink-muted">{meta.why}</p>
      {needsHistory ? (
        <p role="status" className="mb-3 rounded-md border border-line bg-white px-3.5 py-2.5 text-xs text-ink-muted">
          Search Console history does not yet cover all three blocks, so pages can be missed here until the sync fills it.
        </p>
      ) : null}
      {needsPairs ? (
        <p role="status" className="mb-3 rounded-md border border-line bg-white px-3.5 py-2.5 text-xs text-ink-muted">
          This needs to know which page ranks for which query, which the Search Console sync collects from now on. It fills in after the next sync.
        </p>
      ) : null}

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>{params.type === "cannibalisation" ? "Query" : "Page"}</TH>
              <TH>Evidence</TH>
              <TH className="text-right">{meta.impact}</TH>
            </TR>
          </THead>
          <TBody>
            {result.list.rows.length === 0 ? (
              <TableEmpty colSpan={3} title="Nothing found for this." />
            ) : (
              result.list.rows.map((finding, index) => (
                <TR key={`${finding.type}-${"url" in finding ? finding.url : finding.query}-${index}`}>
                  <TD className="max-w-[20rem] align-top">
                    {finding.type === "cannibalisation" ? (
                      <span className="text-sm text-navy-800">{finding.query}</span>
                    ) : (
                      <>
                        <UrlCell url={finding.url} />
                        <CrawlNote crawl={finding.crawl} />
                      </>
                    )}
                  </TD>
                  <TD className="max-w-[34rem] align-top text-2xs text-ink-muted">
                    <Evidence finding={finding} />
                  </TD>
                  <TD className="text-right align-top tabular-nums">{formatCount(finding.impact)}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
      <div className="mt-3">
        <Pagination basePath="/admin/marketing/seo/content" params={{ property: property.id, type: params.type }} page={result.list.page} pages={result.list.pages} total={result.list.total} perPage={PAGE_SIZE} />
      </div>
    </>
  );
}
