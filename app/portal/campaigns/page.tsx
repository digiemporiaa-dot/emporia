import type { Metadata } from "next";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { listCampaigns } from "@/lib/services/portal.service";
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
  const campaigns = await listCampaigns(actor);

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

                  <p className="mt-2 border-t border-line pt-2 text-2xs text-ink-subtle">
                    {campaign._count.metrics > 0
                      ? `${campaign._count.metrics} data point${campaign._count.metrics === 1 ? "" : "s"} recorded.`
                      : "No performance data recorded yet."}{" "}
                    Reporting charts arrive with phase 14; nothing here is estimated or modelled.
                  </p>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
