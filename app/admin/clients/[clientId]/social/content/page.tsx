import type { Metadata } from "next";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { contentFormOptions, listContentItems } from "@/lib/services/social-content.service";
import { CAPABILITIES, POST_TYPE_LABEL, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { SOCIAL_PROVIDERS } from "@/lib/social";
import { isAIConfigured } from "@/lib/ai";
import { db } from "@/lib/db";
import { AiTools } from "./ai-tools";
import type { SocialPostType, SocialProvider } from "@/generated/prisma/enums";
import { ContentList, type ContentItemRow } from "./content-list";

export const metadata: Metadata = { title: "Social content" };

/**
 * The format a repurposed article defaults to on each platform: a link post
 * where the platform has one (the article is the point), otherwise the
 * format that needs the least extra work before it can go out.
 */
const REPURPOSE_DEFAULT: Record<SocialProvider, SocialPostType> = {
  INSTAGRAM: "SINGLE_IMAGE",
  FACEBOOK: "LINK",
  LINKEDIN: "LINK",
  YOUTUBE: "YOUTUBE_SHORT",
  X: "TEXT",
  GOOGLE_BUSINESS_PROFILE: "GBP_POST",
};
export const dynamic = "force-dynamic";

/**
 * Every social idea for one client, with its platform versions beside it.
 *
 * The list is grouped by nothing and sorted by when it is going out, because
 * the question a social team asks this screen is "what is coming up and what
 * state is it in" — not "what belongs to which campaign", which is what the
 * filter is for.
 */
export default async function SocialContentPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { clientId } = await params;
  const query = await searchParams;
  const actor = await requireActorPage(`/admin/clients/${clientId}/social/content`);

  const campaignId = typeof query["campaign"] === "string" ? query["campaign"] : null;
  const pillarId = typeof query["pillar"] === "string" ? query["pillar"] : null;
  const search = typeof query["q"] === "string" ? query["q"] : null;

  const aiReady = can(actor, "ai.use") && can(actor, "social.create") && (await isAIConfigured());
  const [items, options, blogPosts] = await Promise.all([
    listContentItems(actor, { clientId, campaignId, pillarId, search }),
    contentFormOptions(actor, clientId),
    // Published articles only — public already, so nothing is revealed here.
    aiReady
      ? db.blogPost.findMany({
          where: { status: "PUBLISHED" },
          orderBy: { publishedAt: "desc" },
          take: 50,
          select: { id: true, title: true },
        })
      : [],
  ]);

  const rows: ContentItemRow[] = items.map((item) => ({
    id: item.id,
    title: item.title,
    stage: item.stage,
    campaign: item.campaign?.name ?? null,
    pillar: item.pillar?.name ?? null,
    project: item.project.name,
    owner: item.owner?.name ?? null,
    scheduledFor: item.scheduledFor?.toISOString() ?? null,
    approvalStatus: item.approvals[0]?.status ?? null,
    versions: item.socialPosts.map((post) => ({
      id: post.id,
      provider: post.provider,
      providerLabel: PROVIDER_LABEL[post.provider],
      type: post.type,
      status: post.status,
      caption: post.caption,
      scheduledFor: post.scheduledFor?.toISOString() ?? null,
      externalUrl: post.externalUrl,
      lastError: post.lastError,
      aiDraft: post.aiDraftedAt !== null,
      accountName: post.account?.name ?? null,
      thumbnailUrl: post.media[0]?.media.url ?? null,
      mediaCount: post._count.media,
    })),
  }));

  return (
    <ContentList
      clientId={clientId}
      items={rows}
      campaigns={options.campaigns}
      pillars={options.pillars}
      projects={options.projects}
      staff={options.staff}
      activeCampaign={campaignId}
      activePillar={pillarId}
      search={search}
      canCreate={can(actor, "social.create")}
      aiTools={
        aiReady ? (
          <AiTools
            clientId={clientId}
            projects={options.projects}
            campaigns={options.campaigns}
            pillars={options.pillars}
            blogPosts={blogPosts}
            platforms={SOCIAL_PROVIDERS.map((provider) => ({
              provider,
              label: PROVIDER_LABEL[provider],
              types: CAPABILITIES[provider].postTypes.map((value) => ({ value, label: POST_TYPE_LABEL[value] })),
              defaultType: REPURPOSE_DEFAULT[provider],
              connected: options.accounts.some((account) => account.provider === provider),
            }))}
          />
        ) : null
      }
    />
  );
}
