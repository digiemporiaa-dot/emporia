import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { portalPublished } from "@/lib/services/portal-social.service";
import { Card, CardBody } from "@/components/ui";
import { PortalPostCard } from "@/components/portal/social-post-card";

export const metadata: Metadata = { title: "Published posts" };
export const dynamic = "force-dynamic";

/** Everything published on the client's accounts, newest first, with what each post did. */

const params = z.object({ page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1) });
const NUMBER = new Intl.NumberFormat("en-IN");

export default async function PortalPublishedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePortalActorPage();
  const { page } = params.parse(await searchParams);
  const list = await portalPublished(actor, page);

  return (
    <div className="space-y-4">
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
              <p className="text-xs text-ink-muted sm:text-right">
                {post.engagement === null ? (
                  <span className="text-ink-subtle">Figures not reported yet</span>
                ) : (
                  <>
                    {NUMBER.format(post.engagement)} interactions
                    {post.reach !== null ? <span className="block text-2xs text-ink-subtle">{NUMBER.format(post.reach)} reached{post.rate !== null ? ` · ${post.rate.toFixed(2)}%` : ""}</span> : null}
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
      {list.pages > 1 ? (
        <nav aria-label="Pages" className="flex items-center justify-between text-xs">
          {list.page > 1 ? (
            <Link href={`/portal/social/published?page=${list.page - 1}` as Route} className="text-navy-800 underline underline-offset-4">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {list.page < list.pages ? (
            <Link href={`/portal/social/published?page=${list.page + 1}` as Route} className="text-navy-800 underline underline-offset-4">
              Older →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
