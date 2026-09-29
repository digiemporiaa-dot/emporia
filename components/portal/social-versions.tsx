import { CAPABILITIES, POST_TYPE_LABEL, PROVIDER_LABEL } from "@/lib/social/capabilities";
import type { SocialSnapshot } from "@/lib/social/approval-snapshot";

/**
 * The platform versions a client is being asked to sign off.
 *
 * Renders the **snapshot** stored on the approval version, never the live
 * posts — so what is shown is what was sent, and stays that way after the copy
 * is edited for the next round.
 *
 * Written for the reader, not the operator: no post ids, no account ids, no
 * internal status. The account is named because it is theirs and they should
 * know where a post is going; nothing else about it appears, and a token could
 * not reach here even if one were asked for, because the snapshot has no
 * field to carry it.
 */

const TIME = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export function SocialVersions({ snapshot }: { snapshot: SocialSnapshot }) {
  return (
    <ul className="space-y-3">
      {snapshot.posts.map((post) => (
        <li key={post.postId} className="rounded-md border border-line bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-sm bg-navy-800 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-white">
              {PROVIDER_LABEL[post.provider]}
            </span>
            <span className="text-2xs text-ink-subtle">{POST_TYPE_LABEL[post.type]}</span>
            {post.accountName ? (
              <span className="text-2xs text-ink-subtle">· {post.accountName}</span>
            ) : null}
            {post.scheduledFor ? (
              <span className="text-2xs tabular-nums text-ink-subtle">
                · {TIME.format(new Date(post.scheduledFor))}
              </span>
            ) : null}
          </div>

          {post.media.length > 0 ? (
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {post.media.map((asset, index) => (
                <li key={`${post.postId}-${index}`}>
                  {asset.type === "IMAGE" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary uploads on a third-party origin
                    <img
                      src={asset.url}
                      alt={asset.alt ?? ""}
                      className="max-h-56 rounded-md border border-line bg-surface-muted object-contain"
                    />
                  ) : (
                    <a
                      href={asset.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center rounded-md border border-line px-2.5 py-1.5 text-xs text-navy-800 underline underline-offset-2 hover:text-brand-red-text"
                    >
                      Open the {asset.type.toLowerCase()}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {post.headline ? (
            <p className="mt-2.5 text-sm font-medium text-navy-800">{post.headline}</p>
          ) : null}

          {post.caption ? (
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-ink">
              {post.caption}
            </p>
          ) : null}

          {post.hashtags.length > 0 ? (
            <p className="mt-1.5 text-xs text-navy-700">
              {post.hashtags.map((tag) => `#${tag}`).join(" ")}
            </p>
          ) : null}

          {post.mentions.length > 0 ? (
            <p className="mt-1 text-xs text-ink-subtle">
              {post.mentions.map((mention) => `@${mention}`).join(" ")}
            </p>
          ) : null}

          {post.linkUrl ? (
            <p className="mt-1.5 truncate text-2xs text-ink-subtle">
              Links to{" "}
              <a
                href={post.linkUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-navy-800 underline underline-offset-2 hover:text-brand-red-text"
              >
                {post.linkUrl}
              </a>
            </p>
          ) : null}

          {post.callToAction ? (
            <p className="mt-1.5 text-2xs text-ink-subtle">
              {/* A fixed button is stored by its code; the client reads its name. */}
              Button:{" "}
              {CAPABILITIES[post.provider].callToActionOptions?.find((o) => o.value === post.callToAction)
                ?.label ?? post.callToAction}
            </p>
          ) : null}

          {post.firstComment ? (
            <p className="mt-2 whitespace-pre-wrap rounded-md border border-line bg-surface-muted px-2.5 py-2 text-2xs text-ink-muted">
              First comment: {post.firstComment}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
