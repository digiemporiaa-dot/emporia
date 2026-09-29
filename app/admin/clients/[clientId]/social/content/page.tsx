import type { Metadata } from "next";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { contentFormOptions, listContentItems } from "@/lib/services/social-content.service";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { ContentList, type ContentItemRow } from "./content-list";

export const metadata: Metadata = { title: "Social content" };
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

  const [items, options] = await Promise.all([
    listContentItems(actor, { clientId, campaignId, pillarId, search }),
    contentFormOptions(actor, clientId),
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
    />
  );
}
