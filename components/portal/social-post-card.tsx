import { ExternalLink, Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui";
import { POST_TYPE_LABEL, PROVIDER_LABEL } from "@/lib/social/capabilities";
import type { ClientPostCard, ClientPostState } from "@/lib/services/portal-social.service";

/** One post as the client sees it: platform, campaign, where it is, when, and the creative (brief §13). */

export const STATE_LABEL: Record<ClientPostState, string> = {
  IN_REVIEW: "Waiting for your review",
  APPROVED: "Approved",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
  DELAYED: "Delayed — we are on it",
};

const STATE_TONE: Record<ClientPostState, "neutral" | "navy" | "warning" | "success"> = {
  IN_REVIEW: "warning",
  APPROVED: "navy",
  SCHEDULED: "navy",
  PUBLISHED: "success",
  DELAYED: "warning",
};

const WHEN = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function PortalPostCard({ post }: { post: ClientPostCard }) {
  return (
    <div className="flex gap-3 rounded-md border border-line bg-white px-3 py-2.5">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line bg-surface-sunken">
        {post.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- an R2 URL for an arbitrary creative; next/image would need a remote pattern per bucket
          <img src={post.thumbnail.url} alt={post.thumbnail.alt ?? ""} className="size-full object-cover" />
        ) : (
          <ImageIcon size={15} aria-hidden="true" className="text-ink-subtle" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-sm bg-navy-800 px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide text-white">
            {PROVIDER_LABEL[post.provider]}
          </span>
          <Badge tone={STATE_TONE[post.state]}>{STATE_LABEL[post.state]}</Badge>
        </div>
        <p className="mt-1 truncate text-sm text-navy-800">{post.title}</p>
        <p className="text-2xs text-ink-subtle">
          {[post.campaign, POST_TYPE_LABEL[post.type], post.at ? WHEN.format(new Date(post.at)) : null].filter(Boolean).join(" · ")}
          {post.externalUrl ? (
            <>
              {" · "}
              <a href={post.externalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-navy-800">
                <ExternalLink size={10} aria-hidden="true" />
                See it
              </a>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}
