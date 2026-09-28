import type { Metadata } from "next";
import { ExternalLink, Info } from "lucide-react";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { socialReport } from "@/lib/services/portal.service";
import { resolveRange } from "@/lib/analytics/range";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { METRIC_LABEL } from "@/lib/social/metrics";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import type { MetricKey } from "@/lib/social/metrics";

export const metadata: Metadata = { title: "Social" };
export const dynamic = "force-dynamic";

/**
 * The client's own view of their social posts.
 *
 * Every number came from a platform. Where a platform did not report one, this
 * says so — a client shown a zero they did not earn is being misled just as
 * surely as one shown an invented figure (CLAUDE.md 2 rule 5).
 *
 * Only published posts appear. Drafts are not theirs to see, and a post that
 * failed to publish is the agency's problem to fix rather than the client's to
 * discover in a report.
 */

const NUMBER = new Intl.NumberFormat("en-IN");
const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

const HEADLINE: MetricKey[] = ["impressions", "likes", "comments", "clicks"];

export default async function PortalSocialPage() {
  const actor = await requirePortalActorPage();
  // All time, like the campaigns page: a client wants the whole story.
  const report = await socialReport(actor, resolveRange("all"));

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl text-navy-800">Social</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Everything published on your accounts, and what the platforms reported back.
        </p>
      </header>

      {report.posts === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">Nothing has been published yet.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {HEADLINE.map((key) => {
              const total = report.totals[key];
              return (
                <div key={key} className="rounded-lg border border-line bg-white p-4">
                  <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                    {METRIC_LABEL[key]}
                  </p>
                  {total.value === null ? (
                    <>
                      <p className="mt-1.5 text-lg text-ink-subtle">Not reported</p>
                      <p className="mt-0.5 text-2xs text-ink-subtle">
                        The platform does not share this figure with us.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-1.5 text-3xl tabular-nums text-navy-800">
                        {NUMBER.format(total.value)}
                      </p>
                      <p className="mt-0.5 text-2xs text-ink-subtle">
                        across {total.reporting} of {total.total} posts
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {report.truncated ? (
            <p className="flex items-start gap-1.5 rounded-md border border-line bg-surface-muted px-3 py-2 text-2xs text-ink-muted">
              <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
              These totals cover your most recent {report.posts.toLocaleString("en-IN")} posts.
              Ask us for a full-history report.
            </p>
          ) : null}

          <p className="flex items-start gap-1.5 rounded-md border border-line bg-surface-muted px-3 py-2 text-2xs text-ink-muted">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            Platforms differ in what they share. Where a figure is missing it means the platform
            did not report it — not that the number was zero.
          </p>

          <Card>
            <CardHeader>
              <CardTitle>Published</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="divide-y divide-line">
                {report.recent.map((post) => (
                  <li key={post.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-sm bg-navy-800 px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide text-white">
                          {PROVIDER_LABEL[post.provider]}
                        </span>
                        <span className="truncate text-sm text-navy-800">{post.title}</span>
                      </div>
                      <p className="mt-0.5 text-2xs text-ink-subtle">
                        {DATE.format(new Date(post.publishedAt))}
                        {post.externalUrl ? (
                          <>
                            {" · "}
                            <a
                              href={post.externalUrl}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex items-center gap-1 hover:text-navy-800"
                            >
                              <ExternalLink size={10} aria-hidden="true" />
                              See it
                            </a>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                      {post.engagement === null ? (
                        <span className="text-ink-subtle">Not reported</span>
                      ) : (
                        `${NUMBER.format(post.engagement)} interactions`
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
