import Link from "next/link";
import type { Route } from "next";
import { ExternalLink, Info } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { TrendChart } from "@/components/admin/charts";
import { BarList } from "@/components/admin/bar-list";
import { POST_TYPE_LABEL, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { MIN_SAMPLE, reportedTrendKeys, type SlotStats, type TrendKey } from "@/lib/social/insights";
import type { SocialInsights } from "@/lib/services/social-insights.service";

/**
 * Trends, when to post, what works, and what did not (brief §23–24).
 *
 * The honesty rules of the report above carry on here: unmeasured posts are
 * counted as posts but never as zeros, "best" needs at least MIN_SAMPLE
 * measured posts, and days and hours are shown one platform at a time because
 * engagement means different things on each.
 */

const NUMBER = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

const TREND_TITLE: Record<TrendKey, string> = {
  impressions: "Impressions",
  reach: "Reach",
  engagement: "Engagement",
  followersGained: "Followers gained",
};

const rate = (value: number | null) => (value === null ? "—" : `${value.toFixed(2)}%`);
const avg = (value: number | null) => (value === null ? "—" : NUMBER.format(value));

function slotBars(slots: readonly SlotStats[]) {
  return slots.map((slot) => ({
    key: slot.key,
    label: slot.label,
    value: slot.avgEngagement,
    note: slot.posts === 0 ? "no posts" : `${slot.measured} of ${slot.posts} measured`,
  }));
}

function Th({ children, end = false }: { children: React.ReactNode; end?: boolean }) {
  return <th className={`py-1.5 pr-3 text-2xs font-medium uppercase tracking-wide text-ink-subtle ${end ? "text-right" : "text-left"}`}>{children}</th>;
}

export function InsightsView({ clientId, range, data }: { clientId: string; range: string; data: SocialInsights }) {
  const trendKeys = reportedTrendKeys(data.trend);
  const base = `/admin/clients/${clientId}/social/analytics`;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>Trends</CardTitle>
            <p className="text-2xs text-ink-subtle">
              What each day added, from the platforms&rsquo; daily figures. Reach is added up per post, so it counts
              accounts per post rather than unique people.
            </p>
          </div>
        </CardHeader>
        <CardBody>
          {trendKeys.length === 0 ? (
            <p className="text-sm text-ink-subtle">No daily figures were reported in this period.</p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {trendKeys.map((key) => (
                <TrendChart key={key} title={TREND_TITLE[key]} data={data.trend.map((point) => ({ day: point.day, value: point[key] }))} />
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>When to post</CardTitle>
              <p className="text-2xs text-ink-subtle">
                Average engagement per measured post, by the day and hour it went out (India time). One platform at a
                time; a slot is only called best with at least {MIN_SAMPLE} measured posts.
              </p>
            </div>
            {data.providers.length > 1 ? (
              <nav aria-label="Platform" className="flex flex-wrap gap-1">
                {data.providers.map((p) => (
                  <Link
                    key={p.provider}
                    href={`${base}?range=${range}&platform=${p.provider}` as Route}
                    aria-current={p.provider === data.provider ? "page" : undefined}
                    className={`rounded-md border px-2.5 py-1 text-xs ${
                      p.provider === data.provider ? "border-navy-800 bg-navy-800 text-white" : "border-line text-navy-800 hover:border-navy-300"
                    }`}
                  >
                    {PROVIDER_LABEL[p.provider]}
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>
        </CardHeader>
        <CardBody>
          {!data.provider ? (
            <p className="text-sm text-ink-subtle">Nothing was published in this period.</p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-navy-800">
                {data.bestDay || data.bestHour ? (
                  <>
                    On {PROVIDER_LABEL[data.provider]}, posts did best
                    {data.bestDay ? <> on <strong>{data.bestDay.label}</strong></> : null}
                    {data.bestDay && data.bestHour ? " and" : ""}
                    {data.bestHour ? <> around <strong>{data.bestHour.label}</strong></> : null}.
                  </>
                ) : (
                  <span className="text-ink-subtle">
                    Not enough measured {PROVIDER_LABEL[data.provider]} posts yet to say which day or hour works best.
                  </span>
                )}
              </p>
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">By day</p>
                  <BarList label="Average engagement by day" data={slotBars(data.weekdays)} highlight={data.bestDay?.key ?? null} unit="count" />
                </div>
                <div>
                  <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">By hour</p>
                  {data.hours.length === 0 ? (
                    <p className="text-2xs text-ink-subtle">No posts.</p>
                  ) : (
                    <BarList label="Average engagement by hour" data={slotBars(data.hours)} highlight={data.bestHour?.key ?? null} unit="count" />
                  )}
                </div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <div className="space-y-1">
              <CardTitle>By format</CardTitle>
              <p className="text-2xs text-ink-subtle">Compared within each platform.</p>
            </div>
          </CardHeader>
          <CardBody className="overflow-x-auto">
            {data.types.length === 0 ? (
              <p className="text-sm text-ink-subtle">Nothing was published in this period.</p>
            ) : (
              <table className="w-full min-w-[28rem] text-xs">
                <thead>
                  <tr>
                    <Th>Platform · format</Th>
                    <Th end>Posts</Th>
                    <Th end>Avg engagement</Th>
                    <Th end>Engagement rate</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.types.map((row) => (
                    <tr key={row.key} className="border-t border-line">
                      <td className="py-1.5 pr-3 text-navy-800">
                        {PROVIDER_LABEL[row.provider]} · {POST_TYPE_LABEL[row.type]}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {row.posts}
                        {row.measured < row.posts ? <span className="text-ink-subtle"> ({row.measured} measured)</span> : null}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{avg(row.avgEngagement)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{rate(row.avgRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="space-y-1">
              <CardTitle>Campaigns</CardTitle>
              <p className="text-2xs text-ink-subtle">Best engagement rate first — a rate over reach compares across platforms; raw engagement does not.</p>
            </div>
          </CardHeader>
          <CardBody className="overflow-x-auto">
            {data.campaigns.length === 0 ? (
              <p className="text-sm text-ink-subtle">No published post in this period belongs to a campaign.</p>
            ) : (
              <table className="w-full min-w-[28rem] text-xs">
                <thead>
                  <tr>
                    <Th>Campaign</Th>
                    <Th end>Posts</Th>
                    <Th end>Reach</Th>
                    <Th end>Engagement rate</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.campaigns.map((row) => (
                    <tr key={row.key} className="border-t border-line">
                      <td className="py-1.5 pr-3 text-navy-800">{row.label}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{row.posts}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {row.reach === null ? "—" : NUMBER.format(row.reach)}
                        {row.reach !== null && row.reachReporting < row.posts ? (
                          <span className="text-ink-subtle"> ({row.reachReporting} of {row.posts})</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{rate(row.avgRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>Least engagement</CardTitle>
            <p className="text-2xs text-ink-subtle">Measured posts only — a post the platform told us nothing about is unknown, not weak.</p>
          </div>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          {data.lowest.length === 0 ? (
            <p className="text-sm text-ink-subtle">No measured posts in this period.</p>
          ) : (
            <table className="w-full min-w-[36rem] text-xs">
              <thead>
                <tr>
                  <Th>Post</Th>
                  <Th end>Reach</Th>
                  <Th end>Engagement</Th>
                  <Th end>Engagement rate</Th>
                </tr>
              </thead>
              <tbody>
                {data.lowest.map((post) => (
                  <tr key={post.postId} className="border-t border-line">
                    <td className="py-1.5 pr-3">
                      <Link href={`/admin/clients/${clientId}/social/content/${post.itemId}` as Route} className="text-navy-800 hover:text-brand-red-text">
                        {post.title}
                      </Link>
                      <span className="block text-2xs text-ink-subtle">
                        {PROVIDER_LABEL[post.provider]} · {POST_TYPE_LABEL[post.type]} · {DATE.format(new Date(post.publishedAt))}
                        {post.externalUrl ? (
                          <>
                            {" · "}
                            <a href={post.externalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-navy-800">
                              <ExternalLink size={10} aria-hidden="true" />
                              View it
                            </a>
                          </>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{post.reach === null ? "—" : NUMBER.format(post.reach)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{NUMBER.format(post.engagement)}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{rate(post.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      {data.truncated ? (
        <p className="flex items-start gap-1.5 text-2xs text-ink-subtle">
          <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          Covers the most recent posts only; choose a shorter period for complete figures.
        </p>
      ) : null}
    </div>
  );
}
