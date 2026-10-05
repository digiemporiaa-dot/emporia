import type { Metadata, Route } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { siteHistory } from "@/lib/services/seo-intel/history.service";
import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { BarChart, type BarDatum } from "@/components/admin/charts";
import { SeoHeader } from "../seo-header";
import { DATE_TIME, PropertyPicker } from "../crawl-parts";
import { formatCount, formatDay } from "../overview-parts";

export const metadata: Metadata = { title: "SEO history" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ property: z.string().max(40).optional().catch(undefined) });
const MONTH = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });
const WEEK = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const monthLabel = (month: string) => MONTH.format(new Date(`${month}-01T00:00:00Z`));
const SEVERITY_TONE = { HIGH: "red", MEDIUM: "warning", LOW: "neutral" } as const;

function money(value: string, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en-IN", { style: currency ? "currency" : "decimal", currency: currency ?? undefined, maximumFractionDigits: 0 }).format(Number(value));
  } catch {
    return value;
  }
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/history");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const description = "How this website has moved over time: sixteen months of search and organic traffic, every crawl's health, opportunities opened and closed, and what changed.";

  if (!property) {
    return (
      <>
        <SeoHeader current="history" title="History" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const history = await siteHistory(actor, property.id);
  const partial = (row: { days: number; daysInMonth: number } | null) => (row && row.days < row.daysInMonth ? `${row.days} of ${row.daysInMonth} days` : undefined);
  const clicks: BarDatum[] = history.months.map((month, i) => {
    const row = history.search[i] ?? null;
    return { key: month, label: monthLabel(month), value: row?.clicks ?? null, note: partial(row) };
  });
  const impressions: BarDatum[] = history.months.map((month, i) => {
    const row = history.search[i] ?? null;
    return { key: month, label: monthLabel(month), value: row?.impressions ?? null, note: partial(row) };
  });
  const sessions: BarDatum[] = history.months.map((month, i) => {
    const row = history.organic[i] ?? null;
    return { key: month, label: monthLabel(month), value: row?.sessions ?? null, note: partial(row) };
  });
  const revenue: BarDatum[] = history.months.map((month, i) => {
    const row = history.organic[i] ?? null;
    return { key: month, label: monthLabel(month), value: row ? Number(row.revenue) : null, display: row ? money(row.revenue, history.currency) : undefined, note: partial(row) };
  });
  const health: BarDatum[] = history.crawls.map((crawl) => ({ key: crawl.runId, label: WEEK.format(crawl.finishedAt), value: crawl.critical + crawl.warning, note: `${crawl.critical} critical, ${crawl.warning} warnings` }));
  const indexable: BarDatum[] = history.crawls.map((crawl) => ({ key: crawl.runId, label: WEEK.format(crawl.finishedAt), value: crawl.indexablePages, note: `of ${crawl.pagesFetched} fetched` }));

  return (
    <>
      <SeoHeader current="history" title="History" description={description} query={`?property=${property.id}`} canConnect={canConnect} />
      <PropertyPicker id="history-property" properties={properties} current={property.id} />

      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="min-w-0">
            <CardHeader className="flex-col items-start gap-0.5">
              <CardTitle>Search Console</CardTitle>
              <CardDescription>Clicks and impressions per month. A month still in progress, or before data begins, says how many days it covers.</CardDescription>
            </CardHeader>
            <CardBody className="space-y-5">
              <BarChart title="Clicks" data={clicks} emptyText={history.hasSearch ? "Nothing synced yet." : "Search Console is not connected."} />
              <BarChart title="Impressions" data={impressions} emptyText={history.hasSearch ? "Nothing synced yet." : "Search Console is not connected."} />
            </CardBody>
          </Card>
          <Card className="min-w-0">
            <CardHeader className="flex-col items-start gap-0.5">
              <CardTitle>Organic search in Google Analytics</CardTitle>
              <CardDescription>Organic sessions and GA4 revenue per month{history.currency ? `, in ${history.currency}` : ""}.</CardDescription>
            </CardHeader>
            <CardBody className="space-y-5">
              <BarChart title="Organic sessions" data={sessions} emptyText={history.hasAnalytics ? "Nothing synced yet." : "Google Analytics is not connected."} />
              <BarChart title="Revenue (GA4)" data={revenue} emptyText={history.hasAnalytics ? "Nothing synced yet." : "Google Analytics is not connected."} />
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex-col items-start gap-0.5">
            <CardTitle>Site health by crawl</CardTitle>
            <CardDescription>Every finished crawl&rsquo;s critical and warning findings, and how many pages Google may index — kept after the crawl&rsquo;s own pages are pruned.</CardDescription>
          </CardHeader>
          <CardBody>
            {history.crawls.length === 0 ? (
              <p className="text-sm text-ink-subtle">
                No finished crawl yet.{" "}
                <Link href={`/admin/marketing/seo/crawl?property=${property.id}` as Route} className="text-navy-800 underline underline-offset-2">
                  Crawl the website
                </Link>
                .
              </p>
            ) : (
              <div className="grid gap-5 lg:grid-cols-2">
                <BarChart title="Critical and warning findings" data={health} />
                <BarChart title="Indexable pages" data={indexable} />
              </div>
            )}
          </CardBody>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="min-w-0">
            <h2 className="mb-2 text-base text-navy-800">Opportunities per week</h2>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Week of</TH>
                    <TH className="text-right">Opened</TH>
                    <TH className="text-right">Done</TH>
                    <TH className="text-right">Resolved</TH>
                    <TH className="text-right">Dismissed</TH>
                  </TR>
                </THead>
                <TBody>
                  {[...history.flow].reverse().map((week) => (
                    <TR key={week.week}>
                      <TD>{formatDay(week.week)}</TD>
                      <TD className="text-right tabular-nums">{formatCount(week.opened)}</TD>
                      <TD className="text-right tabular-nums">{formatCount(week.done)}</TD>
                      <TD className="text-right tabular-nums text-ink-muted">{formatCount(week.resolved)}</TD>
                      <TD className="text-right tabular-nums text-ink-muted">{formatCount(week.dismissed)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <p className="mt-2 text-2xs text-ink-subtle">Done: marked done by a person. Resolved: the detector no longer finds it. Counted by each item&rsquo;s current status.</p>
          </div>
          <div className="min-w-0">
            <h2 className="mb-2 text-base text-navy-800">What changed</h2>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Period ending</TH>
                    <TH>Change</TH>
                  </TR>
                </THead>
                <TBody>
                  {history.changes.length === 0 ? (
                    <TableEmpty colSpan={2} title="No changes recorded yet." description="Recorded daily by the opportunity detector once Search Console data is in." />
                  ) : (
                    history.changes.map((change) => (
                      <TR key={`${change.key}-${change.periodEnd}`}>
                        <TD className="whitespace-nowrap text-xs">{formatDay(change.periodEnd)}</TD>
                        <TD>
                          <Badge tone={SEVERITY_TONE[change.severity]}>{change.severity.charAt(0) + change.severity.slice(1).toLowerCase()}</Badge>{" "}
                          <span className="text-sm text-navy-800">{change.title}</span>
                        </TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>
            </TableWrap>
          </div>
        </div>
        {history.crawls.length ? <p className="text-2xs text-ink-subtle">Latest crawl {DATE_TIME.format(history.crawls.at(-1)!.finishedAt)}.</p> : null}
      </div>
    </>
  );
}
