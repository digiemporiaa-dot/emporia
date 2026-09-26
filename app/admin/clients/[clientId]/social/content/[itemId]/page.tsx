import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { contentFormOptions, getContentItem } from "@/lib/services/social-content.service";
import { listPostsForItem } from "@/lib/services/social-post.service";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { SOCIAL_PROVIDERS } from "@/lib/social";
import { isAppError } from "@/lib/errors";
import { VersionEditor, type EditorPost, type EditorProvider } from "./version-editor";

export const metadata: Metadata = { title: "Social content" };
export const dynamic = "force-dynamic";

/**
 * One idea, and a version of it per platform.
 *
 * The screen the whole module is for. Each version is edited against its own
 * platform's rules — the fields it offers, the formats it accepts, the caption
 * length it allows — because a LinkedIn post and an Instagram post are not the
 * same text with a different logo on it.
 */
export default async function SocialContentItemPage({
  params,
}: {
  params: Promise<{ clientId: string; itemId: string }>;
}) {
  const { clientId, itemId } = await params;
  const actor = await requireActorPage(`/admin/clients/${clientId}/social/content`);

  let item;
  try {
    item = await getContentItem(actor, itemId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [posts, options] = await Promise.all([
    listPostsForItem(actor, itemId),
    contentFormOptions(actor, clientId),
  ]);

  const editorPosts: EditorPost[] = posts.map((post) => ({
    id: post.id,
    provider: post.provider,
    type: post.type,
    status: post.status,
    accountId: post.accountId,
    caption: post.caption ?? "",
    headline: post.headline ?? "",
    hashtags: post.hashtags,
    mentions: post.mentions,
    callToAction: post.callToAction ?? "",
    firstComment: post.firstComment ?? "",
    linkUrl: post.linkUrl ?? "",
    scheduledFor: post.scheduledFor?.toISOString() ?? null,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    externalUrl: post.externalUrl,
    lastError: post.lastError,
    media: post.media.map((row) => ({
      id: row.media.id,
      url: row.media.url,
      filename: row.media.alt ?? "Creative",
      type: row.media.type,
    })),
  }));

  // The capability table, handed to the client so the editor can offer exactly
  // what each platform accepts without a `provider === "…"` branch in the UI.
  const providers: EditorProvider[] = SOCIAL_PROVIDERS.map((provider) => ({
    provider,
    label: PROVIDER_LABEL[provider],
    postTypes: [...CAPABILITIES[provider].postTypes],
    fields: [...CAPABILITIES[provider].fields],
    captionLimit: CAPABILITIES[provider].captionLimit,
    carouselLimit: CAPABILITIES[provider].carouselLimit,
    accounts: options.accounts
      .filter((account) => account.provider === provider)
      .map((account) => ({ id: account.id, name: account.name, status: account.status })),
  }));

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/admin/clients/${clientId}/social/content` as Route}
          className="text-xs text-ink-subtle hover:text-navy-800"
        >
          ← All content
        </Link>
        <h2 className="mt-1.5 text-xl text-navy-800">{item.title}</h2>
        <p className="mt-1 text-xs text-ink-subtle">
          {[item.campaign?.name, item.project.name, item.owner?.name].filter(Boolean).join(" · ")}
        </p>
        {item.brief ? (
          <p className="mt-3 max-w-2xl whitespace-pre-wrap rounded-md border border-line bg-surface-muted px-3.5 py-3 text-sm text-ink-muted">
            {item.brief}
          </p>
        ) : null}
      </div>

      <VersionEditor
        clientId={clientId}
        itemId={item.id}
        stage={item.stage}
        posts={editorPosts}
        providers={providers}
        canEdit={can(actor, "social.edit")}
        canDelete={can(actor, "social.delete")}
      />
    </div>
  );
}
