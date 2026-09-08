import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import {
  breakdowns,
  overview,
  popupFunnel,
  revenueByDimension,
  type BreakdownRow,
} from "@/lib/services/analytics.service";
import { analyticsParamsSchema } from "@/lib/validation/marketing";
import { RANGE_LABEL, RANGE_PRESETS, resolveRange } from "@/lib/analytics/range";
import { formatMoney } from "@/lib/money";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { AIUnavailable } from "@/components/admin/ai-draft";
import { isAIConfigured } from "@/lib/ai";
import { CRMInsights } from "./crm-insights";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

/**
 * The analytics dashboard.
 *
 * Every number is read from the database. Where a dimension has no data the
 * table says so rather than showing zeros that look like a measurement, and
 * revenue is absent entirely for an actor without finance permission — the
 * service withholds it, this page does not merely hide it.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/analytics");
  requirePermission(actor, "analytics.view");

  const raw = await searchParams;
  const parsed = analyticsParamsSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : analyticsParamsSchema.parse({});
  const range = resolveRange(params.range);

  const seesMoney = can(actor, "invoices.view");

  // Read once per render: the assist panel is offered only when a provider is
  // actually configured, and that is now a database read rather than an
  // environment variable.
  const aiReady = await isAIConfigured();

  const [summary, dims, funnel, revenue] = await Promise.all([
    overview(actor, range),
    breakdowns(actor, range),
    can(actor, "popups.view") ? popupFunnel(actor, range) : Promise.resolve([]),
    seesMoney ? revenueByDimension(actor, range) : Promise.resolve(null),
  ]);

  const best = dims.source[0];

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">
            Analytics
          </p>
          <h1 className="mt-1.5 text-2xl text-navy-800">Where the work comes from</h1>
          <p className="mt-1.5 text-xs text-ink-subtle">
            {RANGE_LABEL[params.range]}.{" "}
            {summary.ownLeadsOnly ? "Your own leads only. " : ""}
            {dims.revenueWithheld
              ? "Revenue is not shown because your role does not include finance."
              : "Revenue is money actually received, attributed to the lead that won the client."}
          </p>
        </div>
        <nav aria-label="Reporting range" className="flex flex-wrap gap-1">
          {RANGE_PRESETS.map((option) => (
            <Link
              key={option}
              href={`/admin/analytics?range=${option}`}
              aria-current={option === params.range ? "true" : undefined}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                option === params.range
                  ? "border-brand-red bg-red-50 text-brand-red-text"
                  : "border-line-strong text-navy-800 hover:border-navy-300"
              }`}
            >
              {RANGE_LABEL[option]}
            </Link>
          ))}
        </nav>
      </header>

      {summary.leads === 0 && !dims.source.length ? (
        <Card>
          <CardBody className="py-12 text-center">
            <p className="text-sm font-medium text-navy-800">Nothing to report for this period</p>
            <p className="mx-auto mt-1.5 max-w-md text-xs text-ink-subtle">
              No leads were captured in {RANGE_LABEL[params.range].toLowerCase()}. Try a wider range,
              or check back once the site starts producing enquiries.
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Leads" value={summary.leads.toLocaleString("en-IN")} />
            <Stat label="Qualified" value={summary.qualified.toLocaleString("en-IN")} />
            <Stat
              label="Won"
              value={summary.won.toLocaleString("en-IN")}
              detail={summary.conversionRate ? `${summary.conversionRate}% of leads` : undefined}
            />
            <Stat label="Pipeline value" value={formatMoney(summary.pipelineValue, "INR")} detail="stated budgets, open leads" />
            {summary.revenue !== null ? (
              <Stat label="Revenue received" value={formatMoney(summary.revenue, "INR")} accent />
            ) : null}
            {summary.outstanding !== null ? (
              <Stat label="Outstanding" value={formatMoney(summary.outstanding, "INR")} detail="all unpaid invoices" />
            ) : null}
            <Stat label="Active clients" value={String(summary.activeClients)} />
            <Stat label="Live projects" value={String(summary.activeProjects)} />
            <Stat label="Tasks due this week" value={String(summary.tasksDue)} />
            <Stat
              label="Tasks overdue"
              value={String(summary.tasksOverdue)}
              accent={summary.tasksOverdue > 0}
            />
          </div>

          {best && !dims.revenueWithheld ? (
            <Card className="mt-5">
              <CardBody>
                <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                  Highest-value source
                </p>
                <p className="mt-1.5 font-display text-xl text-navy-800">{best.label}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {best.leads} lead{best.leads === 1 ? "" : "s"}
                  {best.won > 0 ? `, ${best.won} won` : ""} ·{" "}
                  {best.revenue && best.revenue !== "0.00"
                    ? `${formatMoney(best.revenue, "INR")} received`
                    : `no revenue received yet; ranked on ${formatMoney(best.pipelineValue, "INR")} of stated budget`}
                </p>
              </CardBody>
            </Card>
          ) : null}

          {can(actor, "ai.use") ? (
            <Card className="mt-5">
              <CardHeader>
                <CardTitle>Read of these numbers</CardTitle>
                <p className="text-xs text-ink-subtle">
                  Commentary on the figures on this page. The figures stay ours; only the reading is
                  generated.
                </p>
              </CardHeader>
              <CardBody>
                {aiReady ? <CRMInsights range={params.range} /> : <AIUnavailable />}
              </CardBody>
            </Card>
          ) : null}

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <Breakdown title="By source" rows={dims.source} withheld={dims.revenueWithheld} />
            <Breakdown title="By service" rows={dims.service} withheld={dims.revenueWithheld} />
            <Breakdown title="By city" rows={dims.city} withheld={dims.revenueWithheld} />
            <Breakdown title="By campaign" rows={dims.campaign} withheld={dims.revenueWithheld} />
            <Breakdown title="By popup" rows={dims.popup} withheld={dims.revenueWithheld} />
            <Breakdown title="By owner" rows={dims.owner} withheld={dims.revenueWithheld} />
          </div>

          {revenue ? (
            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              <RevenueTable title="Revenue by service" rows={revenue.service} />
              <RevenueTable title="Revenue by city" rows={revenue.city} />
            </div>
          ) : null}

          {funnel.length > 0 ? (
            <Card className="mt-5">
              <CardHeader>
                <CardTitle>Popup funnel</CardTitle>
              </CardHeader>
              <CardBody>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[36rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line-strong text-left text-2xs uppercase tracking-widest text-ink-subtle">
                        <th scope="col" className="py-2">Popup</th>
                        <th scope="col" className="py-2 text-right">Shown</th>
                        <th scope="col" className="py-2 text-right">Seen</th>
                        <th scope="col" className="py-2 text-right">Started</th>
                        <th scope="col" className="py-2 text-right">Submitted</th>
                        <th scope="col" className="py-2 text-right">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnel.map((row) => (
                        <tr key={row.id} className="border-b border-line">
                          <td className="py-2 text-navy-800">{row.name}</td>
                          <td className="py-2 text-right tabular-nums">{row.impressions}</td>
                          <td className="py-2 text-right tabular-nums">{row.views}</td>
                          <td className="py-2 text-right tabular-nums">{row.formStarts}</td>
                          <td className="py-2 text-right tabular-nums">{row.submissions}</td>
                          <td className="py-2 text-right tabular-nums text-ink-muted">
                            {row.submissionRate ? `${row.submissionRate}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}

function Stat({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardBody>
        <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">{label}</p>
        <p
          className={`mt-1.5 font-display text-2xl tabular-nums ${
            accent ? "text-brand-red" : "text-navy-800"
          }`}
        >
          {value}
        </p>
        {detail ? <p className="text-xs text-ink-subtle">{detail}</p> : null}
      </CardBody>
    </Card>
  );
}

function Breakdown({
  title,
  rows,
  withheld,
}: {
  title: string;
  rows: readonly BreakdownRow[];
  withheld: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-xs text-ink-subtle">Nothing recorded in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line-strong text-left text-2xs uppercase tracking-widest text-ink-subtle">
                  <th scope="col" className="py-2">Name</th>
                  <th scope="col" className="py-2 text-right">Leads</th>
                  <th scope="col" className="py-2 text-right">Won</th>
                  <th scope="col" className="py-2 text-right">Pipeline</th>
                  {withheld ? null : <th scope="col" className="py-2 text-right">Revenue</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line">
                    <td className="py-2 pr-3 text-navy-800">{row.label}</td>
                    <td className="py-2 text-right tabular-nums">{row.leads}</td>
                    <td className="py-2 text-right tabular-nums text-ink-muted">
                      {row.won}
                      {row.conversionRate ? (
                        <span className="ml-1 text-2xs text-ink-subtle">({row.conversionRate}%)</span>
                      ) : null}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-muted">
                      {formatMoney(row.pipelineValue, "INR")}
                    </td>
                    {withheld ? null : (
                      <td className="py-2 text-right font-medium tabular-nums text-navy-800">
                        {row.revenue && row.revenue !== "0.00" ? (
                          formatMoney(row.revenue, "INR")
                        ) : (
                          <span className="font-normal text-ink-subtle">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function RevenueTable({
  title,
  rows,
}: {
  title: string;
  rows: readonly { id: string; label: string; revenue: string; clients: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-xs text-ink-subtle">
            No payments have been received from converted leads in this period.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-4 py-2">
                <span className="min-w-0 truncate text-sm text-navy-800">{row.label}</span>
                <span className="shrink-0 text-right">
                  <span className="block font-medium tabular-nums text-navy-800">
                    {formatMoney(row.revenue, "INR")}
                  </span>
                  <span className="block text-2xs text-ink-subtle">
                    {row.clients} client{row.clients === 1 ? "" : "s"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
