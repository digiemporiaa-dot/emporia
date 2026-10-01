import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { ExternalLink, Image as ImageIcon } from "lucide-react";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { portalDirectPosts, portalPublished, type PortalDirectPost } from "@/lib/services/portal-social.service";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { Card, CardBody } from "@/components/ui";
import { PortalPostCard } from "@/components/portal/social-post-card";

export const metadata: Metadata = { title: "Published posts" };
export const dynamic = "force-dynamic";

/**
 * Everything published on the client's accounts, newest first, with what each
 * post did — what we published, and, apart from it, what the client posted
 * directly on the platforms themselves (brief §48).
 */

const params = z.object({
  source: z.enum(["agency", "direct"]).catch("agency").default("agency"),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});
const NUMBER = new Intl.NumberFormat("en-IN");
const WHEN = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

const chip = (active: boolean) =>
  `rounded-md border px-2.5 py-1 text-xs ${active ? "border-navy-800 bg-navy-800 text-white" : "border-line text-navy-800 hover:border-navy-300"}`;

export default async function PortalPublishedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePortalActorPage();
  const { source, page } = params.parse(await searchParams);

  return (
    <div className="space-y-4">
      <nav aria-label="Source" className="flex flex-wrap gap-1">
        <Link href={"/portal/social/published" as Route} className={chip(source === "agency")} aria-current={source === "agency" ? "page" : undefined}>
          Published by us
        </Link>
        <Link href={"/portal/social/published?source=direct" as Route} className={chip(source === "direct")} aria-current={source === "direct" ? "page" : undefined}>
          Posted directly by you
        </Link>
      </nav>
      {source === "direct" ? <DirectList actor={actor} page={page} /> : <AgencyList actor={actor} page={page} />}
    </div>
  );
}

async function AgencyList({ actor, page }: { actor: Parameters<typeof portalPublished>[0]; page: number }) {
  const list = await portalPublished(actor, page);
  return (
    <>
      <p className="text-xs text-ink-subtle">
        {list.total} published post{list.total === 1 ? "" : "s"}
        {list.pages > 1 ? ` · page ${list.page} of ${list.pages}` : ""}
      </p>
      {list.posts.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">Nothing has been published yet.</p>
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-2">
          {list.posts.map((post) => (
            <li key={post.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
              <PortalPostCard post={post} />
              <Figures engagement={post.engagement} reach={post.reach} rate={post.rate} />
            </li>
          ))}
        </ul>
      )}
      <Pager base="/portal/social/published?" page={list.page} pages={list.pages} />
    </>
  );
}

async function DirectList({ actor, page }: { actor: Parameters<typeof portalDirectPosts>[0]; page: number }) {
  const list = await portalDirectPosts(actor, page);
  return (
    <>
      <p className="text-xs text-ink-subtle">
        Posts you made yourself on your connected accounts. They are shown here for a complete picture, and kept apart
        from our figures and monthly reports. LinkedIn and X do not let us see these.
        {list.total > 0 ? ` ${list.total} found${list.pages > 1 ? ` · page ${list.page} of ${list.pages}` : ""}.` : ""}
      </p>
      {list.posts.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">None found yet. They appear here within a day of being posted.</p>
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-2">
          {list.posts.map((post) => (
            <li key={post.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
              <DirectCard post={post} />
              <Figures engagement={post.engagement} reach={post.reach} rate={null} />
            </li>
          ))}
        </ul>
      )}
      <Pager base="/portal/social/published?source=direct&" page={list.page} pages={list.pages} />
    </>
  );
}

function DirectCard({ post }: { post: PortalDirectPost }) {
  return (
    <div className="flex gap-3 rounded-md border border-line bg-white px-3 py-2.5">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line bg-surface-sunken">
        {post.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a platform CDN URL; next/image would need a remote pattern per platform
          <img src={post.thumbnailUrl} alt="" className="size-full object-cover" />
        ) : (
          <ImageIcon size={16} aria-hidden="true" className="text-ink-subtle" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-sm bg-navy-800 px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide text-white">
            {PROVIDER_LABEL[post.provider]}
          </span>
          <span className="text-2xs text-ink-subtle">{WHEN.format(new Date(post.publishedAt))}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-navy-800">{post.caption ?? "No caption"}</p>
        {post.externalUrl ? (
          <a href={post.externalUrl} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex items-center gap-1 text-2xs text-ink-subtle hover:text-navy-800">
            <ExternalLink size={11} aria-hidden="true" />
            View on {PROVIDER_LABEL[post.provider]}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Figures({ engagement, reach, rate }: { engagement: number | null; reach: number | null; rate: number | null }) {
  return (
    <p className="text-xs text-ink-muted sm:text-right">
      {engagement === null ? (
        <span className="text-ink-subtle">Figures not reported yet</span>
      ) : (
        <>
          {NUMBER.format(engagement)} interactions
          {reach !== null ? (
            <span className="block text-2xs text-ink-subtle">
              {NUMBER.format(reach)} reached{rate !== null ? ` · ${rate.toFixed(2)}%` : ""}
            </span>
          ) : null}
        </>
      )}
    </p>
  );
}

function Pager({ base, page, pages }: { base: string; page: number; pages: number }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between text-xs">
      {page > 1 ? (
        <Link href={`${base}page=${page - 1}` as Route} className="text-navy-800 underline underline-offset-4">
          ← Newer
        </Link>
      ) : (
        <span />
      )}
      {page < pages ? (
        <Link href={`${base}page=${page + 1}` as Route} className="text-navy-800 underline underline-offset-4">
          Older →
        </Link>
      ) : null}
    </nav>
  );
}
