import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { portalSocialOverview } from "@/lib/services/portal-social.service";
import { monthLabel } from "@/lib/social/report-doc";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { PortalPostCard } from "@/components/portal/social-post-card";
import type { MetricTotal } from "@/lib/social/metrics";

export const metadata: Metadata = { title: "Social" };
export const dynamic = "force-dynamic";

/**
 * The client's social month at a glance (brief §16). Every figure is one the
 * platforms reported; a figure none reported says so rather than showing zero.
 */

const COMPACT = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const NUMBER = new Intl.NumberFormat("en-IN");

function Figure({ label, total }: { label: string; total: MetricTotal }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      {total.value === null ? (
        <p className="mt-1.5 text-lg text-ink-subtle">Not reported</p>
      ) : (
        <>
          <p className="mt-1.5 text-3xl tabular-nums text-navy-800" title={NUMBER.format(total.value)}>
            {COMPACT.format(total.value)}
          </p>
          <p className="mt-0.5 text-2xs text-ink-subtle">
            across {total.reporting} of {total.total} posts
          </p>
        </>
      )}
    </div>
  );
}

export default async function PortalSocialOverviewPage() {
  const actor = await requirePortalActorPage();
  const overview = await portalSocialOverview(actor);
  const m = overview.month;

  return (
    <div className="space-y-5">
      {overview.pendingApprovals > 0 ? (
        <Link
          href={"/portal/social/approvals" as Route}
          className="flex items-center justify-between gap-3 rounded-lg border border-brand-red/30 bg-brand-red/5 px-4 py-3 text-sm text-navy-800 hover:border-brand-red"
        >
          <span>
            {overview.pendingApprovals} post{overview.pendingApprovals === 1 ? " is" : "s are"} waiting for your approval
          </span>
          <span className="text-brand-red-text">Review →</span>
        </Link>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>This month · {overview.monthLabel}</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="rounded-lg border border-line bg-white p-4">
              <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Posts published</p>
              <p className="mt-1.5 text-3xl tabular-nums text-navy-800">{NUMBER.format(m.posts)}</p>
              <p className="mt-0.5 text-2xs text-ink-subtle">{m.measured} with figures from the platform</p>
            </div>
            <Figure label="Reach" total={m.reach} />
            <Figure label="Impressions" total={m.impressions} />
            <div className="rounded-lg border border-line bg-white p-4">
              <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Engagement rate</p>
              {m.rate.value === null ? (
                <p className="mt-1.5 text-lg text-ink-subtle">Not reported</p>
              ) : (
                <>
                  <p className="mt-1.5 text-3xl tabular-nums text-navy-800">{m.rate.value.toFixed(1)}%</p>
                  <p className="mt-0.5 text-2xs text-ink-subtle">Engagement over reach, from {m.rate.reporting} posts</p>
                </>
              )}
            </div>
            <Figure label="Followers gained" total={m.followersGained} />
            <Figure label="Engagement" total={m.engagement} />
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Coming up</CardTitle>
              <Link href={"/portal/social/calendar" as Route} className="text-xs text-navy-800 underline underline-offset-4">
                Calendar
              </Link>
            </div>
          </CardHeader>
          <CardBody>
            {overview.upcoming.length === 0 ? (
              <p className="text-sm text-ink-subtle">Nothing is scheduled yet.</p>
            ) : (
              <ul className="space-y-2">
                {overview.upcoming.map((post) => (
                  <li key={post.id}>
                    <PortalPostCard post={post} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Latest report</CardTitle>
          </CardHeader>
          <CardBody>
            {overview.latestReport ? (
              <Link href={`/portal/social/reports/${overview.latestReport.id}` as Route} className="text-sm text-navy-800 underline underline-offset-4">
                {monthLabel(overview.latestReport.month)}
              </Link>
            ) : (
              <p className="text-sm text-ink-subtle">Your first monthly report will appear here.</p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
