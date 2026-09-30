import Link from "next/link";
import type { Route } from "next";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import type { DirectSummary } from "@/lib/services/social-external.service";

const NUMBER = new Intl.NumberFormat("en-IN");

/**
 * The period's posts made directly on the platforms, outside Emporia — its own
 * line, never added into the figures above it (brief §48; the agency's own
 * work stays the headline).
 */
export function DirectPostsCard({ clientId, data }: { clientId: string; data: DirectSummary }) {
  const figures = [
    ["Reach", data.reach],
    ["Impressions", data.impressions],
    ["Engagement", data.engagement],
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Also posted directly on the platforms</CardTitle>
        <p className="text-xs text-ink-subtle">
          Found by the daily account check. Not included in the figures above. LinkedIn and X do not let this app read
          these posts.
        </p>
      </CardHeader>
      <CardBody>
        {data.posts === 0 ? (
          <p className="text-sm text-ink-subtle">None in this period.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">Posts</p>
              <p className="text-xl tabular-nums text-navy-800">{NUMBER.format(data.posts)}</p>
            </div>
            {figures.map(([label, figure]) => (
              <div key={label}>
                <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
                <p className={figure.value === null ? "text-sm text-ink-subtle" : "text-xl tabular-nums text-navy-800"}>
                  {figure.value === null ? "Not reported" : NUMBER.format(figure.value)}
                </p>
                {figure.value !== null ? (
                  <p className="text-2xs text-ink-subtle">
                    from {figure.reporting} of {figure.total}
                  </p>
                ) : null}
              </div>
            ))}
            <Link
              href={`/admin/clients/${clientId}/social/published?source=direct` as Route}
              className="text-xs text-navy-800 underline underline-offset-4"
            >
              See the posts
            </Link>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
