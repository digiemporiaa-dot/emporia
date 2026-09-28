"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { ExternalLink, Info } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, Select } from "@/components/ui";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { METRIC_KEYS, METRIC_LABEL } from "@/lib/social/metrics";
import { RANGE_LABEL, RANGE_PRESETS } from "@/lib/analytics/range";
import type { MetricKey } from "@/lib/social/metrics";
import type { SocialProvider } from "@/generated/prisma/enums";

/**
 * The social report.
 *
 * Stat tiles and tables, no charts. Headline numbers are a KPI row, and a
 * per-platform breakdown of ten metrics is a table — a grouped bar chart of it
 * would need ten series and could not be told apart by anyone.
 *
 * The thing this screen exists to get right is **not reported**. A metric the
 * platform never gave us shows as "Not reported", never as 0, and every figure
 * carries how many posts it came from. A total over 4 of 9 posts that looks
 * like a total over 9 is the quiet way a report starts lying.
 */

export type Totals = Record<MetricKey, { value: number | null; reporting: number; total: number }>;

export type ReportData = {
  posts: number;
  measured: number;
  truncated: boolean;
  totals: Totals;
  byProvider: {
    provider: SocialProvider;
    posts: number;
    measured: number;
    reportsMetrics: boolean;
    totals: Totals;
  }[];
  top: {
    postId: string;
    itemId: string;
    title: string;
    provider: SocialProvider;
    publishedAt: string;
    externalUrl: string | null;
    engagement: number;
  }[];
};

const NUMBER = new Intl.NumberFormat("en-IN");
const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});

/** The four a social team leads with; the rest live in the table. */
const HEADLINE: MetricKey[] = ["impressions", "likes", "comments", "clicks"];

export function ReportView({
  clientId,
  data,
  range,
}: {
  clientId: string;
  data: ReportData;
  range: string;
}) {
  const router = useRouter();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="block">
          <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
            Period
          </span>
          <Select
            className="w-48"
            value={range}
            onChange={(event) =>
              router.push(
                `/admin/clients/${clientId}/social/analytics?range=${event.target.value}` as Route,
              )
            }
          >
            {RANGE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {RANGE_LABEL[preset]}
              </option>
            ))}
          </Select>
        </label>

        <p className="text-xs text-ink-subtle">
          {data.posts} post{data.posts === 1 ? "" : "s"} published
          {data.posts > 0 ? ` · ${data.measured} with figures from the platform` : ""}
        </p>
      </div>

      {data.posts === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">
              Nothing was published in this period.
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {HEADLINE.map((key) => (
              <StatTile key={key} label={METRIC_LABEL[key]} total={data.totals[key]} />
            ))}
          </div>

          {data.truncated ? (
            <p className="flex items-start gap-1.5 rounded-md border border-brand-red/30 bg-brand-red/5 px-3 py-2 text-2xs text-brand-red-text">
              <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              This period has more posts than one report adds up, so these totals cover the most
              recent {data.posts.toLocaleString("en-IN")} only. Choose a shorter period for complete
              figures.
            </p>
          ) : null}

          {data.measured < data.posts ? (
            <p className="flex items-start gap-1.5 rounded-md border border-line bg-surface-muted px-3 py-2 text-2xs text-ink-muted">
              <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              {data.posts - data.measured} of {data.posts} posts have no figures yet. Platforms
              report at their own pace, and some do not report at all — totals cover only the posts
              that did.
            </p>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>By platform</CardTitle>
            </CardHeader>
            <CardBody className="overflow-x-auto">
              <table className="w-full min-w-3xl text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-2xs uppercase tracking-wide text-ink-subtle">
                    <th scope="col" className="py-2 pr-3 font-medium">Platform</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">Posts</th>
                    {METRIC_KEYS.map((key) => (
                      <th key={key} scope="col" className="py-2 pr-3 text-right font-medium">
                        {METRIC_LABEL[key]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.byProvider.map((row) => (
                    <tr key={row.provider}>
                      <th scope="row" className="py-2 pr-3 font-medium text-navy-800">
                        {PROVIDER_LABEL[row.provider]}
                        {row.reportsMetrics ? null : (
                          <span className="ml-1.5 text-2xs font-normal text-ink-subtle">
                            no reporting
                          </span>
                        )}
                      </th>
                      <td className="py-2 pr-3 text-right tabular-nums text-ink-muted">
                        {row.posts}
                      </td>
                      {METRIC_KEYS.map((key) => (
                        <td
                          key={key}
                          className="py-2 pr-3 text-right tabular-nums text-ink-muted"
                        >
                          {row.totals[key].value === null ? (
                            <span className="text-ink-subtle" title="Not reported by this platform">
                              —
                            </span>
                          ) : (
                            NUMBER.format(row.totals[key].value)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-2xs text-ink-subtle">
                A dash means the platform did not report that figure. It does not mean zero.
              </p>
            </CardBody>
          </Card>

          {data.top.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Most engagement</CardTitle>
                <p className="mt-1 text-2xs text-ink-subtle">
                  Likes, comments, shares and saves added together — comparable between posts on
                  the same platform, not across platforms that count different things.
                </p>
              </CardHeader>
              <CardBody>
                <ol className="divide-y divide-line">
                  {data.top.map((entry) => (
                    <li key={entry.postId} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-sm bg-navy-800 px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide text-white">
                            {PROVIDER_LABEL[entry.provider]}
                          </span>
                          <Link
                            href={
                              `/admin/clients/${clientId}/social/content/${entry.itemId}` as Route
                            }
                            className="truncate text-sm text-navy-800 hover:text-brand-red-text"
                          >
                            {entry.title}
                          </Link>
                        </div>
                        <p className="mt-0.5 text-2xs text-ink-subtle">
                          {DATE.format(new Date(entry.publishedAt))}
                          {entry.externalUrl ? (
                            <>
                              {" · "}
                              <a
                                href={entry.externalUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex items-center gap-1 hover:text-navy-800"
                              >
                                <ExternalLink size={10} aria-hidden="true" />
                                View it
                              </a>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm tabular-nums text-navy-800">
                        {NUMBER.format(entry.engagement)}
                      </span>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * One headline number.
 *
 * "Not reported" is a first-class state here rather than a fallback dash,
 * because it is the honest answer far more often than people expect and it
 * must not read like a rendering failure.
 */
function StatTile({
  label,
  total,
}: {
  label: string;
  total: { value: number | null; reporting: number; total: number };
}) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      {total.value === null ? (
        <>
          <p className="mt-1.5 text-lg text-ink-subtle">Not reported</p>
          <p className="mt-0.5 text-2xs text-ink-subtle">
            No platform gave us this figure.
          </p>
        </>
      ) : (
        <>
          <p className="mt-1.5 text-3xl tabular-nums text-navy-800">
            {NUMBER.format(total.value)}
          </p>
          <p className="mt-0.5 text-2xs text-ink-subtle">
            from {total.reporting} of {total.total} post{total.total === 1 ? "" : "s"}
          </p>
        </>
      )}
    </div>
  );
}
