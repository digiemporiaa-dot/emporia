import type { Metadata } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { socialReport } from "@/lib/services/social-metrics.service";
import { socialInsights } from "@/lib/services/social-insights.service";
import { socialAttribution } from "@/lib/services/social-attribution.service";
import { SOCIAL_PROVIDERS } from "@/lib/social";
import { RANGE_PRESETS, resolveRange } from "@/lib/analytics/range";
import { Card, CardBody } from "@/components/ui";
import { ReportView } from "./report-view";
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
  const window = resolveRange(range);
  const [report, insights, attribution] = await Promise.all([
    socialReport(actor, { clientId, from: window.from, to: window.to }),
    socialInsights(actor, { clientId, range: window, provider: platform }),
    socialAttribution(actor, { clientId, range: window }),
  ]);

  return (
    <div className="space-y-5">
      <ReportView
        clientId={clientId}
        range={range}
        data={{
          posts: report.posts,
          measured: report.measured,
          truncated: report.truncated,
          totals: report.totals,
          byProvider: report.byProvider,
          top: report.top,
        }}
      />
      <InsightsView clientId={clientId} range={range} data={insights} />
      <AttributionView clientId={clientId} data={attribution} />
    </div>
  );
}
