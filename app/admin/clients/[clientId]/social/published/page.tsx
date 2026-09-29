import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { ExternalLink, Image as ImageIcon } from "lucide-react";
import { requireActorPage } from "@/lib/actor";
import { listPublished } from "@/lib/services/social-summary.service";
import { contentFormOptions } from "@/lib/services/social-content.service";
import { SOCIAL_PROVIDERS } from "@/lib/social";
import { POST_TYPE_LABEL, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { Card, CardBody } from "@/components/ui";

export const metadata: Metadata = { title: "Published posts" };
export const dynamic = "force-dynamic";

/**
 * What has gone out, newest first, a page at a time, with what each post did
 * and a link to it live. Filters are links, so the server does the filtering.
 */

const params = z.object({
  platform: z.enum(SOCIAL_PROVIDERS).nullable().catch(null).default(null),
  campaign: z.string().max(40).nullable().catch(null).default(null),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

const NUMBER = new Intl.NumberFormat("en-IN");
const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export default async function PublishedPage({
  params: routeParams,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { clientId } = await routeParams;
  const actor = await requireActorPage(`/admin/clients/${clientId}/social/published`);
  const query = params.parse(await searchParams);
  const [list, options] = await Promise.all([
    listPublished(actor, { clientId, provider: query.platform, campaignId: query.campaign, page: query.page }),
    contentFormOptions(actor, clientId),
  ]);

  const base = `/admin/clients/${clientId}/social/published`;
  const href = (next: Partial<{ platform: string | null; campaign: string | null; page: number }>) => {
    const merged = { platform: query.platform, campaign: query.campaign, page: 1, ...next };
    const qs = new URLSearchParams();
    if (merged.platform) qs.set("platform", merged.platform);
    if (merged.campaign) qs.set("campaign", merged.campaign);
    if (merged.page > 1) qs.set("page", String(merged.page));
    const suffix = qs.toString();
    return (suffix ? `${base}?${suffix}` : base) as Route;
  };
  const chip = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-xs ${active ? "border-navy-800 bg-navy-800 text-white" : "border-line text-navy-800 hover:border-navy-300"}`;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <nav aria-label="Platform" className="flex flex-wrap gap-1">
          <Link href={href({ platform: null })} className={chip(!query.platform)} aria-current={!query.platform ? "page" : undefined}>
            All platforms
          </Link>
          {SOCIAL_PROVIDERS.map((provider) => (
            <Link key={provider} href={href({ platform: provider })} className={chip(query.platform === provider)} aria-current={query.platform === provider ? "page" : undefined}>
              {PROVIDER_LABEL[provider]}
            </Link>
          ))}
        </nav>
        {options.campaigns.length > 0 ? (
          <nav aria-label="Campaign" className="flex flex-wrap gap-1">
            <Link href={href({ campaign: null })} className={chip(!query.campaign)}>
              Every campaign
            </Link>
            {options.campaigns.map((campaign) => (
              <Link key={campaign.id} href={href({ campaign: campaign.id })} className={chip(query.campaign === campaign.id)}>
                {campaign.name}
              </Link>
            ))}
          </nav>
        ) : null}
        <p className="text-xs text-ink-subtle">
          {list.total} published post{list.total === 1 ? "" : "s"}
          {list.pages > 1 ? ` · page ${list.page} of ${list.pages}` : ""}
        </p>
      </div>

      {list.posts.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">Nothing published matches.</p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          {/* `relative`: the table's screen-reader labels are absolutely
              positioned, and would otherwise escape this scroll box and widen
              the page on a phone. */}
          <CardBody className="relative overflow-x-auto">
            <table className="w-full min-w-[44rem] text-xs">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-wide text-ink-subtle">
                  <th className="py-1.5 pr-3 font-medium">Post</th>
                  <th className="py-1.5 pr-3 font-medium">Published</th>
                  {list.seesFigures ? (
                    <>
                      <th className="py-1.5 pr-3 text-right font-medium">Reach</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Engagement</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Rate</th>
                    </>
                  ) : null}
                  <th className="py-1.5 font-medium">
                    <span className="sr-only">Live post</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.posts.map((post) => (
                  <tr key={post.id} className="border-t border-line align-top">
                    <td className="py-2 pr-3">
                      <div className="flex gap-2.5">
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line bg-surface-sunken">
                          {post.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element -- an R2 URL for an arbitrary creative; next/image would need a remote pattern per bucket
                            <img src={post.thumbnail.url} alt={post.thumbnail.alt ?? ""} className="size-full object-cover" />
                          ) : (
                            <ImageIcon size={14} aria-hidden="true" className="text-ink-subtle" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link href={`/admin/clients/${clientId}/social/content/${post.itemId}` as Route} className="text-sm text-navy-800 hover:text-brand-red-text">
                            {post.title}
                          </Link>
                          <p className="text-2xs text-ink-subtle">
                            {PROVIDER_LABEL[post.provider]} · {POST_TYPE_LABEL[post.type]}
                            {post.accountName ? ` · ${post.accountName}` : ""}
                            {post.campaign ? ` · ${post.campaign.name}` : ""}
                          </p>
                          {post.caption ? <p className="mt-0.5 line-clamp-1 max-w-md text-2xs text-ink-muted">{post.caption}</p> : null}
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-ink-muted">{post.publishedAt ? DATE.format(new Date(post.publishedAt)) : "—"}</td>
                    {post.figures ? (
                      <>
                        <td className="py-2 pr-3 text-right tabular-nums">{post.figures.reach === null ? "—" : NUMBER.format(post.figures.reach)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{post.figures.engagement === null ? "—" : NUMBER.format(post.figures.engagement)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{post.figures.rate === null ? "—" : `${post.figures.rate.toFixed(2)}%`}</td>
                      </>
                    ) : null}
                    <td className="py-2">
                      {post.externalUrl ? (
                        <a href={post.externalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-ink-subtle hover:text-navy-800">
                          <ExternalLink size={12} aria-hidden="true" />
                          <span className="sr-only">Open the live post</span>
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.seesFigures ? <p className="mt-2 text-2xs text-ink-subtle">A dash means the platform has not reported that figure. It does not mean zero.</p> : null}
          </CardBody>
        </Card>
      )}

      {list.pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between text-xs">
          {list.page > 1 ? (
            <Link href={href({ page: list.page - 1 })} className="text-navy-800 underline underline-offset-4">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {list.page < list.pages ? (
            <Link href={href({ page: list.page + 1 })} className="text-navy-800 underline underline-offset-4">
              Older →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
