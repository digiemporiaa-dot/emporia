import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { isAIConfigured } from "@/lib/ai";
import { contentFormOptions, getContentItem } from "@/lib/services/social-content.service";
import { listPostsForItem } from "@/lib/services/social-post.service";
import { socialApprovalFor } from "@/lib/services/social-approval.service";
import { publicationsFor } from "@/lib/services/social-publish.service";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { SOCIAL_PROVIDERS } from "@/lib/social";
import { isAppError } from "@/lib/errors";
import { VersionEditor, type EditorPost, type EditorProvider } from "./version-editor";
import { ApprovalPanel, type ApprovalSummary } from "./approval-panel";

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

  const [posts, options, approvalRow] = await Promise.all([
    listPostsForItem(actor, itemId),
    contentFormOptions(actor, clientId),
    socialApprovalFor(actor, itemId),
  ]);

  // Only for versions that have actually been tried. Most have not, and asking
  // for an empty history per version would be a query per card for nothing.
  const tried = posts.filter((post) => post.attemptCount > 0);
  const attempts = new Map(
    await Promise.all(
      tried.map(
        async (post) => [post.id, await publicationsFor(actor, post.id)] as const,
      ),
    ),
  );

  // Flattened for the client component: the snapshot itself stays on the
  // server, since the agency side only needs to know how many versions went
  // out, not to re-render them.
  const approval: ApprovalSummary | null = approvalRow
    ? {
        id: approvalRow.id,
        status: approvalRow.status,
        currentVersion: approvalRow.currentVersion,
        decidedAt: approvalRow.decidedAt?.toISOString() ?? null,
        decidedBy: approvalRow.decidedBy?.name ?? null,
        versions: approvalRow.versions.map((version) => ({
          id: version.id,
          version: version.version,
          status: version.status,
          notes: version.notes,
          feedback: version.feedback,
          createdAt: version.createdAt.toISOString(),
          createdBy: version.createdBy?.name ?? null,
          postCount: version.snapshot?.posts.length ?? 0,
        })),
      }
    : null;

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
    attempts: (attempts.get(post.id) ?? []).map((attempt) => ({
      id: attempt.id,
      attempt: attempt.attempt,
      status: attempt.status,
      error: attempt.error,
      at: (attempt.completedAt ?? attempt.attemptedAt).toISOString(),
      by: attempt.triggeredBy?.name ?? null,
    })),
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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <VersionEditor
          clientId={clientId}
          itemId={item.id}
          stage={item.stage}
          posts={editorPosts}
          providers={providers}
          // The copy is frozen while the client is reading it, so the editor
          // matches what the service would enforce rather than offering a
          // save that is going to be refused.
          canEdit={can(actor, "social.edit") && item.stage !== "CLIENT_REVIEW"}
          canDelete={can(actor, "social.delete") && item.stage !== "CLIENT_REVIEW"}
          canPublish={can(actor, "social.publish")}
          aiReady={can(actor, "ai.use") && can(actor, "social.edit") && (await isAIConfigured())}
        />

        <ApprovalPanel
          clientId={clientId}
          itemId={item.id}
          stage={item.stage}
          approval={approval}
          canApprove={can(actor, "social.approve")}
        />
      </div>
    </div>
  );
}
