import type { Metadata } from "next";
import { z } from "zod";
import Link from "next/link";
import type { Route } from "next";
import { Info } from "lucide-react";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { socialReport } from "@/lib/services/portal.service";
import { RANGE_LABEL, resolveRange } from "@/lib/analytics/range";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { METRIC_KEYS, METRIC_LABEL } from "@/lib/social/metrics";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Social analytics" };
export const dynamic = "force-dynamic";

/**
 * What the client's posts did, from the figures the platforms reported. Where a
 * platform did not report one, this says so — a zero the client did not earn
 * misleads as surely as an invented figure (CLAUDE.md 2 rule 5).
 */

const NUMBER = new Intl.NumberFormat("en-IN");
const PERIODS = ["30d", "90d", "ytd", "all"] as const;
const params = z.object({ range: z.enum(PERIODS).catch("all").default("all") });

export default async function PortalSocialAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePortalActorPage();
  const { range } = params.parse(await searchParams);
  const report = await socialReport(actor, resolveRange(range));

  return (
    <div className="space-y-5">
      <nav aria-label="Period" className="flex flex-wrap gap-1">
        {PERIODS.map((p) => (
          <Link
            key={p}
            href={`/portal/social/analytics?range=${p}` as Route}
            aria-current={p === range ? "page" : undefined}
            className={`rounded-md border px-2.5 py-1 text-xs ${p === range ? "border-navy-800 bg-navy-800 text-white" : "border-line text-navy-800 hover:border-navy-300"}`}
          >
            {RANGE_LABEL[p]}
          </Link>
        ))}
      </nav>

      {report.posts === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">Nothing was published in this period.</p>
          </CardBody>
        </Card>
      ) : (
        <>
          <p className="text-xs text-ink-subtle">
            {report.posts} post{report.posts === 1 ? "" : "s"} published · {report.measured} with figures from the platform
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {METRIC_KEYS.map((key) => {
              const total = report.totals[key];
              return (
                <div key={key} className="rounded-lg border border-line bg-white p-4">
                  <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{METRIC_LABEL[key]}</p>
                  {total.value === null ? (
                    <>
                      <p className="mt-1.5 text-lg text-ink-subtle">Not reported</p>
                      <p className="mt-0.5 text-2xs text-ink-subtle">The platforms do not share this figure with us.</p>
                    </>
                  ) : (
                    <>
                      <p className="mt-1.5 text-3xl tabular-nums text-navy-800">{NUMBER.format(total.value)}</p>
                      <p className="mt-0.5 text-2xs text-ink-subtle">
                        across {total.reporting} of {total.total} posts
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>By platform</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="divide-y divide-line">
                {report.byProvider.map((row) => (
                  <li key={row.provider} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-navy-800">{PROVIDER_LABEL[row.provider]}</span>
                    <span className="text-xs text-ink-muted">
                      {row.posts} post{row.posts === 1 ? "" : "s"}
                      {row.reportsMetrics ? "" : " · this platform does not share figures"}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {report.truncated ? (
            <p className="flex items-start gap-1.5 rounded-md border border-line bg-surface-muted px-3 py-2 text-2xs text-ink-muted">
              <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              These totals cover your most recent {report.posts.toLocaleString("en-IN")} posts. Ask us for a full-history report.
            </p>
          ) : null}
          <p className="flex items-start gap-1.5 rounded-md border border-line bg-surface-muted px-3 py-2 text-2xs text-ink-muted">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            Platforms differ in what they share. Where a figure is missing it means the platform did not report it — not that the number was zero.
          </p>
        </>
      )}
    </div>
  );
}
