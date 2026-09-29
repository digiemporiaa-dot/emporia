import type { Metadata } from "next";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { getBrandKit, postingThisWeek } from "@/lib/services/social-brand.service";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { SOCIAL_PROVIDERS } from "@/lib/social";
import { CALENDAR_TIME_ZONE } from "@/lib/social/calendar";
import type { KpiMetric } from "@/lib/validation/social-brand";
import { BrandProfilePanel, PillarsPanel, StrategyPanel } from "./brand-panels";

export const metadata: Metadata = { title: "Brand & strategy" };
export const dynamic = "force-dynamic";

/**
 * A client's brand kit: how they sound, what they talk about, what the agency
 * is aiming at — and one honest comparison, this week's posts against the
 * planned frequency, counted from posts that exist.
 */

const METRIC_LABEL: Record<KpiMetric, string> = {
  postsPublished: "Posts published",
  reach: "Reach",
  impressions: "Impressions",
  engagements: "Engagements",
  followersGained: "Followers gained",
  clicks: "Link clicks",
  videoViews: "Video views",
};

const PERIOD_LABEL = { MONTH: "per month", QUARTER: "per quarter", CAMPAIGN: "per campaign" } as const;

export default async function BrandPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const actor = await requireActorPage(`/admin/clients/${clientId}/social/brand`);
  const canEdit = can(actor, "social.edit");

  const [kit, week] = await Promise.all([getBrandKit(actor, clientId), postingThisWeek(actor, clientId)]);

  const day = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: CALENDAR_TIME_ZONE });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl text-navy-800">Brand &amp; strategy</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          The brief every caption is written against — by the team, or as a first draft by the AI assistant.
        </p>
      </div>

      {week ? (
        <Card>
          <CardHeader>
            <CardTitle>This week against the plan</CardTitle>
            <p className="text-xs text-ink-subtle">
              {day.format(week.from)} – {day.format(new Date(week.to.getTime() - 1))}. Counted from versions
              scheduled or published this week.
            </p>
          </CardHeader>
          <CardBody>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {week.rows.map((row) => {
                const total = row.scheduled + row.published;
                return (
                  <li key={row.provider} className="rounded-md border border-line px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-navy-800">{PROVIDER_LABEL[row.provider]}</span>
                      <Badge tone={total >= row.planned ? "success" : "neutral"}>
                        {total} of {row.planned}
                      </Badge>
                    </div>
                    <p className="mt-1 text-2xs text-ink-subtle">
                      {row.published} published · {row.scheduled} scheduled
                    </p>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <BrandProfilePanel clientId={clientId} profile={kit.profile} canEdit={canEdit} />
        </div>
        <div className="space-y-5">
          <PillarsPanel
            clientId={clientId}
            canEdit={canEdit}
            pillars={kit.pillars.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              archived: p.archivedAt !== null,
              items: p._count.items,
            }))}
          />
          <StrategyPanel
            clientId={clientId}
            canEdit={canEdit}
            strategy={kit.strategy}
            providers={SOCIAL_PROVIDERS.map((value) => ({ value, label: PROVIDER_LABEL[value] }))}
            metrics={Object.entries(METRIC_LABEL).map(([value, label]) => ({ value, label }))}
            periods={Object.entries(PERIOD_LABEL).map(([value, label]) => ({ value, label }))}
          />
        </div>
      </div>
    </div>
  );
}
