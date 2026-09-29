import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import { requireActorPage } from "@/lib/actor";
import { socialOverview } from "@/lib/services/social-overview.service";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import type { MetricTotal } from "@/lib/social/metrics";

export const metadata: Metadata = { title: "Social media" };
export const dynamic = "force-dynamic";

/**
 * The client's social section at a glance (brief §7). Every number is a stored
 * row counted or summed; nothing is estimated, and a figure no platform
 * reported says so.
 */

const COMPACT = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const NUMBER = new Intl.NumberFormat("en-IN");

const HEALTH = {
  HEALTHY: { label: "Connected", icon: CheckCircle2, className: "text-success" },
  EXPIRING: { label: "Expiring soon", icon: AlertTriangle, className: "text-warning" },
  ATTENTION: { label: "Needs attention", icon: AlertTriangle, className: "text-brand-red-text" },
  DISCONNECTED: { label: "Disconnected", icon: CircleDashed, className: "text-ink-subtle" },
} as const;

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className={`mt-1.5 tabular-nums ${value === "Not reported" ? "text-lg text-ink-subtle" : "text-3xl text-navy-800"}`}>{value}</p>
      <p className="mt-0.5 text-2xs text-ink-subtle">{hint}</p>
    </div>
  );
}

const metric = (total: MetricTotal, prefix = "") =>
  total.value === null
    ? { value: "Not reported", hint: "No platform reported this." }
    : { value: `${prefix}${COMPACT.format(total.value)}`, hint: `${NUMBER.format(total.value)}, from ${total.reporting} of ${total.total} posts` };

export default async function SocialOverviewPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const actor = await requireActorPage(`/admin/clients/${clientId}/social`);
  const overview = await socialOverview(actor, clientId);
  const base = `/admin/clients/${clientId}/social`;
  const perf = overview.performance;

  const work = [
    { label: "Waiting for internal review", value: overview.work.internalReviews, href: `${base}/approvals` },
    { label: "With the client", value: overview.work.clientApprovals, href: `${base}/approvals` },
    { label: "Scheduled posts", value: overview.work.scheduled, href: `${base}/calendar?view=list` },
    { label: "Failed posts", value: overview.work.failed, href: "/admin/social/queue", alert: overview.work.failed > 0 },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <div className="space-y-1">
              <CardTitle>This month · {overview.month.label}</CardTitle>
              <p className="text-2xs text-ink-subtle">From the figures the platforms reported for posts published this month.</p>
            </div>
          </CardHeader>
          <CardBody>
            {!perf ? (
              <p className="text-sm text-ink-subtle">You do not have permission to see social analytics.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Stat label="Posts published" value={NUMBER.format(perf.posts)} hint={`${perf.measured} with figures from the platform`} />
                <Stat label="Reach" {...metric(perf.totals.reach)} />
                <Stat label="Impressions" {...metric(perf.totals.impressions)} />
                <Stat
                  label="Engagement rate"
                  value={perf.rate.value === null ? "Not reported" : `${perf.rate.value.toFixed(1)}%`}
                  hint={perf.rate.value === null ? "Needs posts that reported reach." : `Engagement over reach, from ${perf.rate.reporting} posts`}
                />
                <Stat label="Followers gained" {...metric(perf.totals.followersGained, "+")} />
                <Stat label="Engagement" {...metric(perf.totals.engagement)} />
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Work in progress</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-line">
              {work.map((row) => (
                <li key={row.label}>
                  <Link href={row.href as Route} className="flex items-center justify-between gap-3 py-2.5 text-sm hover:text-brand-red-text">
                    <span className="text-navy-800">{row.label}</span>
                    <span className={`tabular-nums ${row.alert ? "font-semibold text-brand-red-text" : "text-navy-800"}`}>{row.value}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Connected accounts</CardTitle>
            <Link href={`${base}/accounts` as Route} className="text-xs text-brand-red-text underline underline-offset-4">
              Manage accounts
            </Link>
          </div>
        </CardHeader>
        <CardBody>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {overview.platforms.map((platform) => (
              <li key={platform.provider} className="rounded-md border border-line px-3 py-2.5">
                <p className="text-sm font-medium text-navy-800">{platform.label}</p>
                {platform.accounts.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {platform.accounts.map((account) => {
                      const health = HEALTH[account.health];
                      const Icon = health.icon;
                      return (
                        <li key={account.id} className="flex items-center gap-1.5 text-2xs">
                          <Icon size={12} aria-hidden="true" className={health.className} />
                          <span className="truncate text-navy-800">{account.name}</span>
                          <span className="text-ink-subtle">· {health.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-1 text-2xs text-ink-subtle">
                    {!platform.implemented ? "Not available yet" : !platform.configured ? "Not configured" : "Not connected"}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
