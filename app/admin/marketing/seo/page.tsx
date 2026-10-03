import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties, propertyOrigin } from "@/lib/services/seo-intel/property.service";
import { getSEOOverview } from "@/lib/services/seo-intel/overview.service";
import { SEO_PERIOD_LABEL, SEO_PERIODS, type SeoPeriod } from "@/lib/seo-intel/periods";
import { Badge, Button, Card, CardBody, CardDescription, CardHeader, CardTitle, Select } from "@/components/ui";
import { TrendChart } from "@/components/admin/charts";
import { SeoHeader } from "./seo-header";
import { ChangeList, formatCount, formatDay, formatPct, formatPosition, formatRange, Kpi, TopTable } from "./overview-parts";

export const metadata: Metadata = { title: "SEO Intelligence" };
export const dynamic = "force-dynamic";

/**
 * Executive Overview.
 *
 * Today it can only say which website is selected and which of its data
 * sources are connected — and that is all it says. Clicks, rankings, the
 * Emporia SEO Health Score and "What changed" appear as each source is
 * connected (docs/SEO-INTELLIGENCE-PLAN.md, Part E); until then the screen
 * states what is missing rather than showing a zero that would read as "no
 * traffic" (CLAUDE.md 2 rule 5).
 */
export default async function SeoOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/marketing/seo");
  requirePermission(actor, "seo.intelligence.view");

  const raw = await searchParams;
  const requested = typeof raw["property"] === "string" ? raw["property"] : null;
  const properties = await listProperties(actor, { status: "active" });
  const canManage = can(actor, "seo.intelligence.manage");

  if (properties.length === 0) {
    return (
      <>
        <SeoHeader current="overview" title="SEO Intelligence" description="What is happening in search, why, and what to do next — for each client's websites." />
        <Card>
          <CardBody className="py-10 text-center">
            <h2 className="font-display text-lg text-navy-800">No websites yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-subtle">
              Everything here is about a website: a client&apos;s, or your own. Add one, then connect its Search Console
              to start collecting data.
            </p>
            {canManage ? (
              <div className="mt-5">
                <Link href="/admin/marketing/seo/properties/new">
                  <Button>Add website</Button>
                </Link>
              </div>
            ) : (
              <p className="mt-4 text-xs text-ink-subtle">Someone with SEO management access can add one.</p>
            )}
          </CardBody>
        </Card>
      </>
    );
  }

  // An id that is not one of the listed (active, visible) properties falls
  // back to the first rather than reading anything by the raw id.
  const property = properties.find((candidate) => candidate.id === requested) ?? (properties[0] as (typeof properties)[number]);
  const period: SeoPeriod = SEO_PERIODS.includes(raw["period"] as SeoPeriod) ? (raw["period"] as SeoPeriod) : "28d";
  const overview = await getSEOOverview(actor, property.id, period);
  const canConnect = can(actor, "seo.intelligence.connect");

  const sources: { name: string; state: "connected" | "missing"; detail: string }[] = [
    {
      name: "Google Search Console",
      state: property.gscSiteUrl ? "connected" : "missing",
      detail: property.gscSiteUrl
        ? `${property.gscSiteUrl}${overview.state === "ready" ? ` · data through ${formatDay(overview.dataThrough)}` : " · first sync pending"}`
        : "Not connected yet. Clicks, impressions, CTR, average position and queries come from here.",
    },
    {
      name: "Google Analytics 4",
      state: property.ga4PropertyId ? "connected" : "missing",
      detail: property.ga4PropertyId
        ? property.ga4PropertyId
        : "Not connected yet. Organic sessions, engagement and conversions come from here.",
    },
    {
      name: "Site crawl",
      state: "missing",
      detail: "Not run yet. Technical issues, indexability, internal links and schema come from crawling the site.",
    },
    {
      name: "Rankings",
      state: property.gscSiteUrl ? "connected" : "missing",
      detail: "Search Console average position per query. No rank-tracking provider is configured, so exact daily positions are not available.",
    },
    {
      name: "SERP and backlinks",
      state: "missing",
      detail: "No provider configured. These screens will say so rather than estimate.",
    },
  ];

  return (
    <>
      <SeoHeader
        current="overview"
        title="SEO Intelligence"
        description="What is happening in search, why, and what to do next — for each client's websites."
        query={`?property=${property.id}`}
        canConnect={canConnect}
      />

      <form className="mb-5 flex flex-wrap items-end gap-2">
        <input type="hidden" name="period" value={period} />
        <label htmlFor="seo-property" className="sr-only">
          Website
        </label>
        <Select id="seo-property" name="property" defaultValue={property.id} className="w-full max-w-md">
          {properties.map((option) => (
            <option key={option.id} value={option.id}>
              {option.client.name} — {option.displayName} ({option.domain})
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>

      {overview.state === "ready" ? (
        <section aria-labelledby="seo-performance" className="mb-6 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="seo-performance" className="font-display text-lg text-navy-800">
                Organic search
              </h2>
              <p className="text-2xs text-ink-subtle">
                Search Console · {formatRange(overview.period.current)} compared with {overview.period.comparedWith} (
                {formatRange(overview.period.previous)}). Data through {formatDay(overview.dataThrough)}; Google lags two to
                three days and reports Pacific-time days.
              </p>
            </div>
            <nav aria-label="Comparison period" className="flex flex-wrap gap-1">
              {SEO_PERIODS.map((key) => (
                <Link
                  key={key}
                  href={`/admin/marketing/seo?property=${property.id}&period=${key}`}
                  aria-current={key === period ? "page" : undefined}
                  className={
                    key === period
                      ? "rounded-md bg-navy-800 px-2.5 py-1 text-xs font-medium text-white"
                      : "rounded-md border border-line bg-white px-2.5 py-1 text-xs text-ink-muted hover:text-navy-800"
                  }
                >
                  {SEO_PERIOD_LABEL[key]}
                </Link>
              ))}
            </nav>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Clicks" value={formatCount(overview.kpis.clicks.current ?? 0)} pair={overview.kpis.clicks} />
            <Kpi label="Impressions" value={formatCount(overview.kpis.impressions.current ?? 0)} pair={overview.kpis.impressions} />
            <Kpi label="CTR" value={formatPct(overview.kpis.ctr.current)} pair={overview.kpis.ctr} />
            <Kpi
              label="Average position"
              value={formatPosition(overview.kpis.position.current)}
              pair={overview.kpis.position}
              kind="absolute"
              higherIsBetter={false}
            />
            <Kpi label="Queries with impressions" value={formatCount(overview.keywords.ranking.current ?? 0)} pair={overview.keywords.ranking} note={overview.keywords.capped ? "at least" : undefined} />
            <Kpi label="Queries in top 3" value={formatCount(overview.keywords.top3.current ?? 0)} pair={overview.keywords.top3} note="avg. position" />
            <Kpi label="Queries in top 10" value={formatCount(overview.keywords.top10.current ?? 0)} pair={overview.keywords.top10} note="avg. position" />
            <div className="rounded-lg border border-dashed border-line px-4 py-3">
              <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Sessions, leads, revenue</p>
              <p className="mt-1 text-xs text-ink-subtle">
                From Google Analytics 4 and the CRM once they are connected. Indexed pages come with the site crawl.
              </p>
            </div>
          </div>

          <Card>
            <CardHeader className="flex-col items-start gap-0.5">
              <CardTitle>What changed</CardTitle>
              <CardDescription>
                Movements beyond fixed thresholds (traffic ±20%, CTR ±20%, position ±1, pages losing 30%+). Calculated by
                Emporia from Search Console; nothing estimated.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <ChangeList changes={overview.changes} propertyId={property.id} period={period} />
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardBody>
                <TrendChart title="Clicks per day" data={overview.series.map((day) => ({ day: day.date, value: day.clicks }))} />
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <TrendChart title="Impressions per day" data={overview.series.map((day) => ({ day: day.date, value: day.impressions }))} />
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex items-baseline justify-between gap-2">
                <CardTitle>Top queries</CardTitle>
                <Link href={`/admin/marketing/seo/performance?property=${property.id}&period=${period}&view=queries`} className="text-xs text-navy-800 underline underline-offset-2 hover:text-brand-red">
                  All queries
                </Link>
              </CardHeader>
              <CardBody>
                <TopTable rows={overview.topQueries} label="Queries" />
              </CardBody>
            </Card>
            <Card>
              <CardHeader className="flex items-baseline justify-between gap-2">
                <CardTitle>Top pages</CardTitle>
                <Link href={`/admin/marketing/seo/performance?property=${property.id}&period=${period}&view=pages`} className="text-xs text-navy-800 underline underline-offset-2 hover:text-brand-red">
                  All pages
                </Link>
              </CardHeader>
              <CardBody>
                <TopTable rows={overview.topPages} label="Pages" isUrl />
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Devices</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="space-y-1.5 text-sm">
                  {overview.devices.map((device) => (
                    <li key={device.key} className="flex flex-wrap justify-between gap-x-3">
                      <span className="capitalize text-navy-800">{device.key.toLowerCase()}</span>
                      <span className="tabular-nums text-ink-muted">
                        {formatCount(device.clicks)} clicks · {formatCount(device.impressions)} impr. · pos. {formatPosition(device.position)}
                      </span>
                    </li>
                  ))}
                  {overview.devices.length === 0 ? <li className="text-ink-subtle">No device data in this period.</li> : null}
                </ul>
              </CardBody>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Countries</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="space-y-1.5 text-sm">
                  {overview.countries.map((country) => (
                    <li key={country.key} className="flex flex-wrap justify-between gap-x-3">
                      <span className="font-mono text-xs uppercase text-navy-800">{country.key}</span>
                      <span className="tabular-nums text-ink-muted">
                        {formatCount(country.clicks)} clicks · {formatCount(country.impressions)} impr.
                      </span>
                    </li>
                  ))}
                  {overview.countries.length === 0 ? <li className="text-ink-subtle">No country data in this period.</li> : null}
                </ul>
              </CardBody>
            </Card>
          </div>
        </section>
      ) : property.gscSiteUrl ? (
        <p role="status" className="mb-5 rounded-md border border-line bg-white px-3.5 py-3 text-sm text-ink-muted">
          Search Console is connected; the first sync has not brought in any data yet.{" "}
          <Link href={`/admin/marketing/seo/properties/${property.id}/search-console`} className="text-navy-800 underline underline-offset-2">
            See its status
          </Link>
          .
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader className="flex-col items-start gap-0.5">
            <CardTitle>{property.displayName}</CardTitle>
            <CardDescription>
              <a href={propertyOrigin(property)} target="_blank" rel="noreferrer noopener" className="font-mono hover:text-navy-800">
                {propertyOrigin(property)}
              </a>
            </CardDescription>
          </CardHeader>
          <CardBody>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-subtle">Client</dt>
              <dd className="text-navy-800">
                {property.client.name}
                {property.client.isInternal ? <span className="ml-1 text-xs text-ink-subtle">(our own website)</span> : null}
              </dd>
              <dt className="text-ink-subtle">Main market</dt>
              <dd className="text-navy-800">{property.defaultCountry?.name ?? "Not set"}</dd>
              <dt className="text-ink-subtle">Language</dt>
              <dd className="font-mono text-navy-800">{property.defaultLanguage}</dd>
              <dt className="text-ink-subtle">Time zone</dt>
              <dd className="text-navy-800">{property.timezone.replace(/_/g, " ")}</dd>
              <dt className="text-ink-subtle">Tasks go to</dt>
              <dd className="text-navy-800">{property.project ? `${property.project.code} — ${property.project.name}` : "No project chosen"}</dd>
              <dt className="text-ink-subtle">Ownership</dt>
              <dd className="text-navy-800">
                {property.verifiedAt ? "Verified through Search Console" : "Not verified — confirmed when Search Console is connected"}
              </dd>
            </dl>
            {canManage ? (
              <div className="mt-4">
                <Link href={`/admin/marketing/seo/properties/${property.id}`} className="text-sm text-navy-800 underline underline-offset-2 hover:text-brand-red">
                  Edit website
                </Link>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex-col items-start gap-0.5">
            <CardTitle>Data sources</CardTitle>
            <CardDescription>
              Every figure on these screens comes from one of these. The Emporia SEO Health Score is calculated only
              once there is data to calculate it from.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-line">
              {sources.map((source) => (
                <li key={source.name} className="flex items-start justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-navy-800">
                      {source.name}
                      {source.name === "Google Search Console" ? (
                        <Link href={`/admin/marketing/seo/properties/${property.id}/search-console`} className="ml-2 text-xs text-navy-800 underline underline-offset-2 hover:text-brand-red">
                          {property.gscSiteUrl ? "Manage" : "Connect"}
                        </Link>
                      ) : null}
                    </p>
                    <p className="mt-0.5 break-words text-xs text-ink-subtle">{source.detail}</p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap">
                    {source.state === "connected" ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Not yet</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
