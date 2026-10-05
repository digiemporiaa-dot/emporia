import type { Metadata, Route } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { crmOrganicFunnel, crmPeriod, ga4OrganicOverview } from "@/lib/services/seo-intel/organic.service";
import { percentChange, SEO_PERIOD_LABEL, type SeoPeriod } from "@/lib/seo-intel/periods";
import { countryName } from "@/lib/geo/countries";
import { Card, CardBody, CardDescription, CardHeader, CardTitle, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { TrendChart } from "@/components/admin/charts";
import { SeoHeader } from "../seo-header";
import { FilterLinks, PropertyPicker, Stat } from "../crawl-parts";
import { formatCount, formatPct, formatRange, Kpi } from "../overview-parts";

export const metadata: Metadata = { title: "Organic → revenue" };
export const dynamic = "force-dynamic";

const PERIODS = ["7d", "28d", "mom", "yoy"] as const satisfies readonly SeoPeriod[];
const paramsSchema = z.object({
  property: z.string().max(40).optional().catch(undefined),
  period: z.enum(PERIODS).catch("28d"),
});

/** Display only: a stored decimal string in a currency, in an English admin. */
function money(value: string | null, currency: string | null): string {
  if (value === null) return "—";
  const amount = Number(value);
  if (!currency) return amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const pair = (current: number | null, previous: number | null) => ({ current, previous, change: current === null || previous === null ? null : percentChange(current, previous) });

function Queries({ queries }: { queries: { query: string; clicks: number }[] }) {
  if (!queries.length) return <span className="text-2xs text-ink-subtle">—</span>;
  return (
    <ul className="space-y-0.5">
      {queries.map((q) => (
        <li key={q.query} className="text-2xs text-ink-muted">
          {q.query} <span className="tabular-nums text-ink-subtle">· {formatCount(q.clicks)}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function OrganicRevenuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/revenue");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const description =
    "What organic search brings in. GA4's organic sessions, key events and revenue for any website; for the agency's own website, the leads whose first visit came from search and the clients and payments that followed. Search Console queries are shown beside each page as context — leads and revenue are never divided among keywords.";

  if (!property) {
    return (
      <>
        <SeoHeader current="revenue" title="Organic → revenue" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const ga4 = await ga4OrganicOverview(actor, property.id, params.period);
  const period = ga4.state === "ready" ? ga4.period : null;
  const crm = await crmOrganicFunnel(actor, property.id, crmPeriod(period));
  const base = `/admin/marketing/seo/revenue?property=${property.id}`;
  const connectHref = `/admin/marketing/seo/properties/${property.id}/analytics` as Route;

  return (
    <>
      <SeoHeader current="revenue" title="Organic → revenue" description={description} query={`?property=${property.id}`} canConnect={canConnect} />
      <PropertyPicker id="revenue-property" properties={properties} current={property.id} hidden={{ period: params.period }} />

      <section aria-labelledby="ga4-heading" className="mb-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="ga4-heading" className="text-lg text-navy-800">
              Organic search in Google Analytics
            </h2>
            {ga4.state === "ready" ? (
              <p className="text-xs text-ink-subtle">
                {formatRange(ga4.period.current)} compared with {ga4.period.comparedWith} · GA4 &ldquo;Organic Search&rdquo; channel{ga4.currency ? ` · revenue in ${ga4.currency}` : ""}
              </p>
            ) : null}
          </div>
          {ga4.state === "ready" ? (
            <FilterLinks label="Period" items={PERIODS.map((p) => ({ key: p, label: SEO_PERIOD_LABEL[p], href: `${base}&period=${p}` as Route, current: p === params.period }))} />
          ) : null}
        </div>

        {ga4.state === "not-connected" ? (
          <Card>
            <CardBody className="text-sm text-ink-subtle">
              Google Analytics is not connected for this website.{" "}
              <Link href={connectHref} className="text-navy-800 underline underline-offset-2">
                Connect it
              </Link>{" "}
              to see organic sessions, key events and revenue.
            </CardBody>
          </Card>
        ) : ga4.state === "no-data" ? (
          <Card>
            <CardBody className="text-sm text-ink-subtle">
              Connected, but nothing has been synced yet{ga4.connection?.lastSyncError ? `: ${ga4.connection.lastSyncError}` : ""}.{" "}
              <Link href={connectHref} className="text-navy-800 underline underline-offset-2">
                See the connection
              </Link>
              .
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Kpi label="Organic sessions" value={formatCount(ga4.current.sessions)} pair={pair(ga4.current.sessions, ga4.previous.sessions)} note={ga4.organicShare !== null ? `${formatPct(ga4.organicShare)} of all sessions` : undefined} />
              <Kpi label="Engagement rate" value={formatPct(ga4.current.engagementRate)} pair={pair(ga4.current.engagementRate, ga4.previous.engagementRate)} />
              <Kpi label="Key events" value={formatCount(Math.round(ga4.current.keyEvents))} pair={pair(ga4.current.keyEvents, ga4.previous.keyEvents)} />
              <Kpi label="Key event rate" value={formatPct(ga4.current.keyEventRate, 2)} pair={pair(ga4.current.keyEventRate, ga4.previous.keyEventRate)} note="per session" />
              <Kpi label="Revenue (GA4)" value={money(ga4.current.revenue, ga4.currency)} pair={pair(Number(ga4.current.revenue), Number(ga4.previous.revenue))} note="GA4's figure" />
            </div>

            <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
              <Card className="min-w-0">
                <CardHeader className="flex-col items-start gap-0.5">
                  <CardTitle>Organic sessions per day</CardTitle>
                </CardHeader>
                <CardBody>
                  <TrendChart title="Organic sessions" data={ga4.trend} emptyText="No organic sessions in this period." />
                </CardBody>
              </Card>
              <Card className="min-w-0">
                <CardHeader className="flex-col items-start gap-0.5">
                  <CardTitle>All channels</CardTitle>
                  <CardDescription>Sessions by GA4 default channel group.</CardDescription>
                </CardHeader>
                <CardBody>
                  <ul className="space-y-1 text-sm">
                    {ga4.channels.map((row) => (
                      <li key={row.channel} className="flex justify-between gap-3">
                        <span className={row.channel === "Organic Search" ? "font-medium text-navy-800" : "text-ink-muted"}>{row.channel}</span>
                        <span className="tabular-nums text-ink-muted">{formatCount(row.sessions)}</span>
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            </div>

            <div className="min-w-0">
              <h3 className="mb-2 text-base text-navy-800">Organic landing pages</h3>
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Landing page</TH>
                      <TH className="text-right">Sessions</TH>
                      <TH className="text-right">Key events</TH>
                      <TH className="text-right">Rate</TH>
                      <TH className="text-right">Revenue</TH>
                      <TH className="text-right">Search clicks</TH>
                      <TH>Top search queries</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {ga4.landing.length === 0 ? (
                      <TableEmpty colSpan={7} title="No organic landing pages in this period." />
                    ) : (
                      ga4.landing.map((row) => (
                        <TR key={row.path}>
                          <TD className="max-w-[16rem] break-all font-mono text-2xs text-navy-800">{row.path}</TD>
                          <TD className="text-right tabular-nums">{formatCount(row.sessions)}</TD>
                          <TD className="text-right tabular-nums">{formatCount(Math.round(row.keyEvents))}</TD>
                          <TD className="text-right tabular-nums text-ink-muted">{formatPct(row.keyEventRate, 2)}</TD>
                          <TD className="text-right tabular-nums text-ink-muted">{money(row.revenue, ga4.currency)}</TD>
                          <TD className="text-right tabular-nums text-ink-muted">{row.search ? formatCount(row.search.clicks) : "—"}</TD>
                          <TD className="min-w-[12rem]">
                            <Queries queries={row.queries} />
                          </TD>
                        </TR>
                      ))
                    )}
                  </TBody>
                </Table>
              </TableWrap>
              <p className="mt-2 text-2xs text-ink-subtle">
                Top {ga4.landing.length} of {formatCount(ga4.landingPages)} pages. Search clicks and queries are Search Console&rsquo;s for the same days (Pacific time), matched by path.
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              {(
                [
                  ["Countries", ga4.countries.map((row) => ({ key: row.country, label: row.country === "ZZ" ? "Unknown" : (countryName(row.country) ?? row.country), sessions: row.sessions, keyEvents: row.keyEvents }))],
                  ["Devices", ga4.devices.map((row) => ({ key: row.device, label: row.device, sessions: row.sessions, keyEvents: row.keyEvents }))],
                ] as const
              ).map(([title, rows]) => (
                <div key={title} className="min-w-0">
                  <h3 className="mb-2 text-base text-navy-800">{title}</h3>
                  <TableWrap>
                    <Table>
                      <THead>
                        <TR>
                          <TH>{title === "Countries" ? "Country" : "Device"}</TH>
                          <TH className="text-right">Organic sessions</TH>
                          <TH className="text-right">Key events</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {rows.length === 0 ? (
                          <TableEmpty colSpan={3} title="No data in this period." />
                        ) : (
                          rows.map((row) => (
                            <TR key={row.key}>
                              <TD className="capitalize">{row.label}</TD>
                              <TD className="text-right tabular-nums">{formatCount(row.sessions)}</TD>
                              <TD className="text-right tabular-nums text-ink-muted">{formatCount(Math.round(row.keyEvents))}</TD>
                            </TR>
                          ))
                        )}
                      </TBody>
                    </Table>
                  </TableWrap>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="crm-heading">
        <h2 id="crm-heading" className="text-lg text-navy-800">
          Leads, clients and payments
        </h2>
        {crm.state === "not-applicable" ? (
          <p className="mt-1 text-sm text-ink-subtle">
            Only for the agency&rsquo;s own website: its leads are the only ones Emporia captures. For a client&rsquo;s website, GA4 key events above are the conversions.
          </p>
        ) : crm.state === "no-permission" ? (
          <p className="mt-1 text-sm text-ink-subtle">Seeing lead figures needs the Analytics permission.</p>
        ) : (
          <div className="mt-1 space-y-5">
            <p className="text-xs text-ink-subtle">
              {formatRange(crm.period.current)} · leads whose first recorded visit came from organic search (a search engine referrer and no campaign tag, or utm_medium=organic). Payments are those received in these days from clients whose converting lead was organic, each client counted once.
              {crm.seesMoney ? "" : " Payment figures need the invoices permission."}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label="Organic leads" value={formatCount(crm.funnel.leads)} note={`of ${formatCount(crm.totalLeads)} leads · ${formatCount(crm.unknownSource)} with no first visit recorded`} />
              <Stat label="Qualified" value={formatCount(crm.funnel.qualified)} note="Qualified, proposal, negotiation or won" />
              <Stat label="With an opportunity" value={formatCount(crm.funnel.opportunities)} note="In the sales pipeline" />
              <Stat label="Became clients" value={formatCount(crm.funnel.clients)} note="Converted leads" />
              <Stat label="Payments received" value={crm.funnel.revenue === null ? "—" : money(crm.funnel.revenue, "INR")} note={crm.funnel.revenue === null ? "Needs invoices permission" : `${formatCount(crm.funnel.revenueClients)} organic clients paid`} />
            </div>

            <div className="min-w-0">
              <h3 className="mb-2 text-base text-navy-800">By landing page</h3>
              <TableWrap>
                <Table>
                  <THead>
                    <TR>
                      <TH>Landing page</TH>
                      <TH className="text-right">Organic sessions</TH>
                      <TH className="text-right">Leads</TH>
                      <TH className="text-right">Lead rate</TH>
                      <TH className="text-right">Qualified</TH>
                      <TH className="text-right">Clients</TH>
                      {crm.seesMoney ? <TH className="text-right">Payments</TH> : null}
                      <TH>Top search queries</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {crm.landing.length === 0 ? (
                      <TableEmpty colSpan={crm.seesMoney ? 8 : 7} title="No organic leads in these days." />
                    ) : (
                      crm.landing.map((row) => (
                        <TR key={row.key}>
                          <TD className="max-w-[16rem] break-all font-mono text-2xs text-navy-800">{row.label}</TD>
                          <TD className="text-right tabular-nums text-ink-muted">{row.sessions === null ? "—" : formatCount(row.sessions)}</TD>
                          <TD className="text-right tabular-nums">{formatCount(row.leads)}</TD>
                          <TD className="text-right tabular-nums text-ink-muted">{formatPct(row.leadRate, 2)}</TD>
                          <TD className="text-right tabular-nums">{formatCount(row.qualified)}</TD>
                          <TD className="text-right tabular-nums">{formatCount(row.clients)}</TD>
                          {crm.seesMoney ? <TD className="text-right tabular-nums">{money(row.revenue, "INR")}</TD> : null}
                          <TD className="min-w-[12rem]">
                            <Queries queries={row.queries} />
                          </TD>
                        </TR>
                      ))
                    )}
                  </TBody>
                </Table>
              </TableWrap>
            </div>

            <div className="grid gap-5 xl:grid-cols-3">
              {(
                [
                  ["Service", crm.service],
                  ["City", crm.city],
                  ["Campaign", crm.campaign],
                ] as const
              ).map(([title, rows]) => (
                <div key={title} className="min-w-0">
                  <h3 className="mb-2 text-base text-navy-800">By {title.toLowerCase()}</h3>
                  <TableWrap>
                    <Table>
                      <THead>
                        <TR>
                          <TH>{title}</TH>
                          <TH className="text-right">Leads</TH>
                          <TH className="text-right">Clients</TH>
                          {crm.seesMoney ? <TH className="text-right">Payments</TH> : null}
                        </TR>
                      </THead>
                      <TBody>
                        {rows.length === 0 ? (
                          <TableEmpty colSpan={crm.seesMoney ? 4 : 3} title="None." />
                        ) : (
                          rows.map((row) => (
                            <TR key={row.key}>
                              <TD>{row.label}</TD>
                              <TD className="text-right tabular-nums">{formatCount(row.leads)}</TD>
                              <TD className="text-right tabular-nums">{formatCount(row.clients)}</TD>
                              {crm.seesMoney ? <TD className="text-right tabular-nums">{money(row.revenue, "INR")}</TD> : null}
                            </TR>
                          ))
                        )}
                      </TBody>
                    </Table>
                  </TableWrap>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
