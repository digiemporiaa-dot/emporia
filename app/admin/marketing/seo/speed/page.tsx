import type { Metadata, Route } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { cwvOverview } from "@/lib/services/seo-intel/cwv.service";
import { CWV_THRESHOLDS, rateMetric, type CwvMetric, type CwvRating } from "@/lib/seo-intel/engine/cwv";
import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { BarChart, type BarDatum } from "@/components/admin/charts";
import { SeoHeader } from "../seo-header";
import { ActionForm } from "../action-form";
import { DATE_TIME, PropertyPicker, UrlCell } from "../crawl-parts";
import { formatDay } from "../overview-parts";
import { checkCwvNowAction } from "./actions";

export const metadata: Metadata = { title: "Page speed" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ property: z.string().max(40).optional().catch(undefined) });
const RATING: Record<CwvRating, { label: string; tone: "success" | "warning" | "red" }> = {
  good: { label: "Good", tone: "success" },
  "needs-improvement": { label: "Needs improvement", tone: "warning" },
  poor: { label: "Poor", tone: "red" },
};
const LABEL: Record<CwvMetric, string> = { lcp: "Largest paint (LCP)", inp: "Responsiveness (INP)", cls: "Layout shift (CLS)", fcp: "First paint (FCP)", ttfb: "Server response (TTFB)" };

function show(metric: CwvMetric, value: number | null): string {
  if (value === null) return "—";
  if (metric === "cls") return value.toFixed(2);
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value} ms`;
}

function Rating({ rating }: { rating: CwvRating | null }) {
  if (!rating) return <span className="text-xs text-ink-subtle">Not enough data</span>;
  return <Badge tone={RATING[rating].tone}>{RATING[rating].label}</Badge>;
}

type Figures = { periodEnd: string; verdict: CwvRating | null } & Record<CwvMetric, number | null>;

function OriginCard({ title, figures }: { title: string; figures: Figures | null }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="flex-col items-start gap-0.5">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{figures ? `The 28 days to ${formatDay(figures.periodEnd)}, 75th percentile.` : "Google has too little Chrome traffic from these devices to report."}</CardDescription>
      </CardHeader>
      {figures ? (
        <CardBody className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-navy-800">
            Core Web Vitals: <Rating rating={figures.verdict} />
          </p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(Object.keys(LABEL) as CwvMetric[]).map((metric) => (
              <div key={metric} className="rounded-md border border-line p-2.5">
                <dt className="text-2xs text-ink-subtle">{LABEL[metric]}</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-lg tabular-nums text-navy-800">{show(metric, figures[metric])}</span>
                  {figures[metric] !== null ? <Rating rating={rateMetric(metric, figures[metric])} /> : null}
                </dd>
              </div>
            ))}
          </dl>
        </CardBody>
      ) : null}
    </Card>
  );
}

export default async function PageSpeedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/speed");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const canManage = can(actor, "seo.intelligence.manage");
  const description = "Core Web Vitals as real Chrome users experienced them, from Google's Chrome UX Report: the whole site on phones and desktops, and the twenty pages with the most search clicks. Checked weekly.";

  if (!property) {
    return (
      <>
        <SeoHeader current="speed" title="Page speed" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const cwv = await cwvOverview(actor, property.id);
  const trend: BarDatum[] = cwv.trend.map((row) => ({ key: row.periodEnd, label: formatDay(row.periodEnd), value: row.lcp, display: show("lcp", row.lcp) }));

  return (
    <>
      <SeoHeader current="speed" title="Page speed" description={description} query={`?property=${property.id}`} canConnect={canConnect} />
      <PropertyPicker id="speed-property" properties={properties} current={property.id} />

      {!cwv.configured ? (
        <Card>
          <CardBody>
            <p className="text-sm text-navy-800">Core Web Vitals are not configured.</p>
            <p className="mt-1 text-xs text-ink-subtle">
              They need a Chrome UX Report API key.{" "}
              {canConnect ? (
                <Link href={"/admin/marketing/seo/settings" as Route} className="text-navy-800 underline underline-offset-2">
                  Add it in SEO settings
                </Link>
              ) : (
                "Ask someone who manages SEO settings to add it"
              )}
              . Until then nothing is checked and no figures are shown.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-subtle">
              {cwv.checkedAt ? `Last checked ${DATE_TIME.format(cwv.checkedAt)}.` : "Not checked yet — the first check runs on the next schedule."}
              {cwv.error ? <span className="ml-1 text-brand-red-text">{cwv.error}</span> : null}
            </p>
            {canManage ? <ActionForm action={checkCwvNowAction} label="Check now" pendingLabel="Checking…" variant="secondary" hidden={{ propertyId: property.id }} className="space-y-0" /> : null}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <OriginCard title="Whole site on phones" figures={cwv.phone} />
            <OriginCard title="Whole site on desktops" figures={cwv.desktop} />
          </div>

          {trend.length > 1 ? (
            <Card className="min-w-0">
              <CardHeader className="flex-col items-start gap-0.5">
                <CardTitle>Largest paint on phones, week by week</CardTitle>
                <CardDescription>Each bar is a 28-day period ending that day. Good is {show("lcp", CWV_THRESHOLDS.lcp.good)} or less; lower is better.</CardDescription>
              </CardHeader>
              <CardBody>
                <BarChart title="LCP (75th percentile)" data={trend} />
              </CardBody>
            </Card>
          ) : null}

          <div className="min-w-0">
            <h2 className="mb-2 text-base text-navy-800">Top pages on phones</h2>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Page</TH>
                    <TH>Verdict</TH>
                    <TH className="text-right">LCP</TH>
                    <TH className="text-right">INP</TH>
                    <TH className="text-right">CLS</TH>
                    <TH className="text-right">Period to</TH>
                  </TR>
                </THead>
                <TBody>
                  {cwv.pages.length === 0 ? (
                    <TableEmpty
                      colSpan={6}
                      title="No page-level figures"
                      description="Pages come from Search Console's top clicks; each needs enough Chrome traffic of its own for Google to report it."
                    />
                  ) : (
                    cwv.pages.map((page) => (
                      <TR key={page.url}>
                        <TD className="max-w-md">
                          <UrlCell url={page.url} />
                        </TD>
                        <TD>
                          <Rating rating={page.verdict} />
                        </TD>
                        <TD className="text-right tabular-nums">{show("lcp", page.lcp)}</TD>
                        <TD className="text-right tabular-nums">{show("inp", page.inp)}</TD>
                        <TD className="text-right tabular-nums">{show("cls", page.cls)}</TD>
                        <TD className="text-right text-xs text-ink-subtle">{formatDay(page.periodEnd)}</TD>
                      </TR>
                    ))
                  )}
                </TBody>
              </Table>
            </TableWrap>
          </div>
        </div>
      )}
    </>
  );
}
