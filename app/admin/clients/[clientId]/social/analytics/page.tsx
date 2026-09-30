import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { socialReport } from "@/lib/services/social-metrics.service";
import { socialInsights } from "@/lib/services/social-insights.service";
import { socialAttribution } from "@/lib/services/social-attribution.service";
import { directPostsForPeriod } from "@/lib/services/social-external.service";
import { SOCIAL_PROVIDERS } from "@/lib/social";
import { RANGE_PRESETS, resolveRange } from "@/lib/analytics/range";
import { Card, CardBody } from "@/components/ui";
import { TableSkeleton } from "@/components/admin/table-skeleton";
import { PeriodSelect } from "./period-select";
import { ReportView } from "./report-view";
import { DirectPostsCard } from "./direct-posts-card";
import { InsightsView } from "./insights-view";
import { AttributionView } from "./attribution-view";

export const metadata: Metadata = { title: "Social analytics" };
export const dynamic = "force-dynamic";

/**
 * What the posts actually did.
 *
 * Every number here came from a platform and was stored; nothing is derived to
 * fill a gap, and a metric nobody reported says so rather than showing zero
 * (CLAUDE.md 2 rule 5, and 16 — campaign numbers come from the database or
 * they do not appear).
 */

const paramsSchema = z.object({
  range: z.enum(RANGE_PRESETS).catch("30d"),
  platform: z.enum(SOCIAL_PROVIDERS).nullable().catch(null).default(null),
});

export default async function SocialAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { clientId } = await params;
  const raw = await searchParams;
  const actor = await requireActorPage(`/admin/clients/${clientId}/social/analytics`);

  if (!can(actor, "social.analytics.view")) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-ink-subtle">
            You do not have permission to see social analytics.
          </p>
        </CardBody>
      </Card>
    );
  }

  const { range, platform } = paramsSchema.parse(raw);

  // The period stays usable while its figures load: they stream in under a
  // Suspense boundary (not a `loading.tsx` — see components/admin/table-skeleton.tsx).
  return (
    <div className="space-y-5">
      <PeriodSelect clientId={clientId} range={range} />
      <Suspense key={`${range}:${platform ?? ""}`} fallback={<TableSkeleton rows={8} />}>
        <AnalyticsData actor={actor} clientId={clientId} range={range} platform={platform} />
      </Suspense>
    </div>
  );
}

/** Everything that waits on the period's queries. */
async function AnalyticsData({
  actor,
  clientId,
  range,
  platform,
}: {
  actor: Parameters<typeof socialReport>[0];
  clientId: string;
  range: z.infer<typeof paramsSchema>["range"];
  platform: z.infer<typeof paramsSchema>["platform"];
}) {
  const window = resolveRange(range);
  const [report, insights, attribution, direct] = await Promise.all([
    socialReport(actor, { clientId, from: window.from, to: window.to }),
    socialInsights(actor, { clientId, range: window, provider: platform }),
    socialAttribution(actor, { clientId, range: window }),
    directPostsForPeriod(actor, { clientId, from: window.from, to: window.to }),
  ]);

  return (
    <div className="space-y-5">
      <ReportView
        clientId={clientId}
        data={{
          posts: report.posts,
          measured: report.measured,
          truncated: report.truncated,
          totals: report.totals,
          byProvider: report.byProvider,
          top: report.top,
        }}
      />
      <DirectPostsCard clientId={clientId} data={direct} />
      <InsightsView clientId={clientId} range={range} data={insights} />
      <AttributionView clientId={clientId} data={attribution} />
    </div>
  );
}
