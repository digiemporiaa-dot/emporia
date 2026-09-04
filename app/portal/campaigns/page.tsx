import type { Metadata } from "next";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { campaignReport, listCampaigns } from "@/lib/services/portal.service";
import { resolveRange } from "@/lib/analytics/range";
import { formatMoney } from "@/lib/money";
import { Badge, Card, CardBody } from "@/components/ui";
import type { CampaignStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

const TONE: Record<CampaignStatus, "neutral" | "navy" | "warning" | "success"> = {
  DRAFT: "neutral",
  ACTIVE: "navy",
  PAUSED: "warning",
  COMPLETED: "success",
};

export default async function PortalCampaignsPage() {
  const actor = await requirePortalActorPage();

  // All-time, because a client wants the campaign's whole story, not a window.
  const range = resolveRange("all");
  const [campaigns, report] = await Promise.all([
    listCampaigns(actor),
    campaignReport(actor, range),
  ]);
  const performance = new Map(report.map((row) => [row.id, row]));

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl text-navy-800">Campaigns</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Your live and past campaigns, with the budget agreed for each.
        </p>
      </header>

      {campaigns.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">No campaigns are set up yet.</p>
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Card>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-navy-800">{campaign.name}</p>
                      <p className="mt-0.5 text-2xs text-ink-subtle">
                        {[
                          campaign.platform.replace(/_/g, " ").toLowerCase(),
                          campaign.objective,
                          `from ${DATE.format(campaign.startsAt)}`,
                          campaign.endsAt ? `to ${DATE.format(campaign.endsAt)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={TONE[campaign.status]}>
                        {campaign.status.toLowerCase()}
                      </Badge>
                      <span className="tabular-nums text-sm text-navy-800">
                        {formatMoney(campaign.budget, campaign.currency)}
                      </span>
                    </span>
                  </div>

                  {(() => {
                    const stats = performance.get(campaign.id);
                    if (!stats || stats.days === 0) {
                      return (
                        <p className="mt-2 border-t border-line pt-2 text-2xs text-ink-subtle">
                          No performance data has been recorded for this campaign yet. Nothing here
                          is estimated or modelled — figures appear once they are measured.
                        </p>
                      );
                    }

                    return (
                      <div className="mt-2 border-t border-line pt-2.5">
                        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                          <Metric label="Impressions" value={stats.impressions.toLocaleString("en-IN")} />
                          <Metric label="Clicks" value={stats.clicks.toLocaleString("en-IN")} />
                          <Metric label="CTR" value={stats.ctr ? `${stats.ctr}%` : "—"} />
                          <Metric
                            label="Spend"
                            value={formatMoney(stats.spend, campaign.currency)}
                          />
                        </dl>
                        <p className="mt-2 text-2xs text-ink-subtle">
                          From {stats.days} day{stats.days === 1 ? "" : "s"} of recorded data
                          {stats.revenue
                            ? `. Revenue attributed by the platform: ${formatMoney(stats.revenue, campaign.currency)}`
                            : ". The platform did not attribute revenue, so none is shown"}
                          .
                        </p>
                      </div>
                    );
                  })()}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-widest text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm tabular-nums text-navy-800">{value}</dd>
    </div>
  );
}
