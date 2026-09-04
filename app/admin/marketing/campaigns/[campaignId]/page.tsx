import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getCampaign, listMetrics } from "@/lib/services/campaign.service";
import { campaignPerformance } from "@/lib/services/analytics.service";
import { isAppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { resolveRange } from "@/lib/analytics/range";
import { REPORTING_PROVIDER_LABEL, REPORTING_PROVIDERS } from "@/lib/reporting/types";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { CampaignForm } from "../campaign-form";
import { DeleteMetric, ImportMetrics, RecordMetric } from "./metric-panels";
import type { CampaignStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Campaign" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const TONE: Record<CampaignStatus, "neutral" | "navy" | "warning" | "success"> = {
  DRAFT: "neutral",
  ACTIVE: "navy",
  PAUSED: "warning",
  COMPLETED: "success",
};

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const actor = await requireActorPage("/admin/marketing/campaigns");
  requirePermission(actor, "campaigns.view");

  let campaign;
  try {
    campaign = await getCampaign(actor, campaignId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const range = resolveRange("all");

  const [metrics, performance, clients, staff] = await Promise.all([
    listMetrics(actor, campaignId),
    campaignPerformance(actor, range),
    can(actor, "campaigns.edit")
      ? db.client.findMany({
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    can(actor, "campaigns.edit")
      ? db.user.findMany({
          where: { type: "STAFF", status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const totals = performance.find((row) => row.id === campaignId);
  const editable = can(actor, "campaigns.edit");

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/marketing" className="hover:text-navy-800">
            Marketing
          </Link>
          <span aria-hidden="true"> / </span>
          <Link href="/admin/marketing/campaigns" className="hover:text-navy-800">
            Campaigns
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{campaign.name}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{campaign.name}</h1>
          <Badge tone={TONE[campaign.status]}>{campaign.status.toLowerCase()}</Badge>
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          {[
            campaign.client?.name,
            `owned by ${campaign.owner.name}`,
            `from ${DATE.format(campaign.startsAt)}`,
            campaign.endsAt ? `to ${DATE.format(campaign.endsAt)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Lifetime performance</CardTitle>
              <p className="text-xs text-ink-subtle">
                {totals && totals.days > 0
                  ? `From ${totals.days} day${totals.days === 1 ? "" : "s"} of recorded data.`
                  : "No performance data has been recorded yet."}
              </p>
            </CardHeader>
            <CardBody>
              {totals && totals.days > 0 ? (
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Spend" value={formatMoney(totals.spend, campaign.currency)} />
                  <Stat label="Impressions" value={totals.impressions.toLocaleString("en-IN")} />
                  <Stat label="Clicks" value={totals.clicks.toLocaleString("en-IN")} />
                  <Stat label="CTR" value={totals.ctr ? `${totals.ctr}%` : "—"} />
                  <Stat
                    label="Cost per click"
                    value={totals.cpc ? formatMoney(totals.cpc, campaign.currency) : "—"}
                  />
                  <Stat label="Platform conversions" value={String(totals.conversions)} />
                  <Stat label="CRM leads" value={String(totals.leads)} />
                  <Stat
                    label="Cost per lead"
                    value={totals.cpl ? formatMoney(totals.cpl, campaign.currency) : "—"}
                  />
                </dl>
              ) : (
                <p className="text-sm text-ink-subtle">
                  Enter a day on the right, or import an export from the platform.
                </p>
              )}

              {totals && totals.reportedRevenue === null && totals.days > 0 ? (
                <p className="mt-4 border-t border-line pt-3 text-2xs text-ink-subtle">
                  No revenue has been recorded against this campaign. That is not the same as
                  earning nothing — revenue only appears here when someone records it.
                </p>
              ) : null}
              {totals?.reportedRevenue ? (
                <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">
                  Revenue recorded against this campaign:{" "}
                  <span className="font-medium tabular-nums text-navy-800">
                    {formatMoney(totals.reportedRevenue, campaign.currency)}
                  </span>
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recorded days</CardTitle>
            </CardHeader>
            <CardBody>
              {metrics.length === 0 ? (
                <p className="text-xs text-ink-subtle">Nothing recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line-strong text-left text-2xs uppercase tracking-widest text-ink-subtle">
                        <th scope="col" className="py-2">Date</th>
                        <th scope="col" className="py-2 text-right">Impressions</th>
                        <th scope="col" className="py-2 text-right">Clicks</th>
                        <th scope="col" className="py-2 text-right">Conversions</th>
                        <th scope="col" className="py-2 text-right">Spend</th>
                        <th scope="col" className="py-2 text-right">Revenue</th>
                        <th scope="col" className="py-2">Source</th>
                        {editable ? (
                          <th scope="col" className="py-2 text-right">
                            <span className="sr-only">Remove</span>
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.map((metric) => (
                        <tr key={metric.id} className="border-b border-line">
                          <td className="py-2 text-xs text-ink-muted">{DATE.format(metric.date)}</td>
                          <td className="py-2 text-right tabular-nums">
                            {metric.impressions.toLocaleString("en-IN")}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {metric.clicks.toLocaleString("en-IN")}
                          </td>
                          <td className="py-2 text-right tabular-nums">{metric.conversions}</td>
                          <td className="py-2 text-right tabular-nums">
                            {formatMoney(metric.spend, campaign.currency)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-ink-muted">
                            {metric.revenue === null ? (
                              <span className="text-ink-subtle">not measured</span>
                            ) : (
                              formatMoney(metric.revenue, campaign.currency)
                            )}
                          </td>
                          <td className="py-2">
                            <Badge tone={metric.source === "IMPORT" ? "navy" : "neutral"}>
                              {metric.source.toLowerCase()}
                            </Badge>
                          </td>
                          {editable ? (
                            <td className="py-2 text-right">
                              <DeleteMetric id={metric.id} campaignId={campaignId} />
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          {editable ? (
            <Card>
              <CardHeader>
                <CardTitle>Campaign details</CardTitle>
              </CardHeader>
              <CardBody>
                <CampaignForm
                  campaign={{
                    id: campaign.id,
                    name: campaign.name,
                    clientId: campaign.clientId,
                    platform: campaign.platform,
                    objective: campaign.objective,
                    budget: campaign.budget,
                    currency: campaign.currency,
                    ownerId: campaign.ownerId,
                    status: campaign.status,
                    startsAt: campaign.startsAt.toISOString().slice(0, 10),
                    endsAt: campaign.endsAt ? campaign.endsAt.toISOString().slice(0, 10) : null,
                  }}
                  clients={clients}
                  staff={staff}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>

        <aside className="space-y-5">
          {editable ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Record a day</CardTitle>
                </CardHeader>
                <CardBody>
                  <RecordMetric campaignId={campaignId} />
                </CardBody>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Import from the platform</CardTitle>
                </CardHeader>
                <CardBody>
                  <ImportMetrics campaignId={campaignId} />
                </CardBody>
              </Card>
            </>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Automatic sync</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="text-xs text-ink-subtle">
                The reporting boundary exists, but no provider is implemented yet. Until one is,
                numbers arrive the two honest ways: typed in, or imported from an export.
              </p>
              <ul className="mt-2.5 space-y-1">
                {REPORTING_PROVIDERS.map((provider) => (
                  <li
                    key={provider}
                    className="flex items-center justify-between gap-2 text-xs text-ink-muted"
                  >
                    {REPORTING_PROVIDER_LABEL[provider]}
                    <Badge>not connected</Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 font-display text-lg tabular-nums text-navy-800">{value}</dd>
    </div>
  );
}
