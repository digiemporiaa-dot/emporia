import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { resolveClientScope } from "@/lib/social/scope";
import { assertPillarForClient } from "@/lib/services/social-brand.service";
import type { Prisma } from "@/generated/prisma/client";
import type { ContentStage } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";

/**
 * Content ideas, seen from the social side.
 *
 * A "social content item" is a `ContentCalendarItem` — the same row the
 * delivery calendar, the approval workflow and the client portal already use.
 * What this service adds is the view social work needs: one idea with all of
 * its platform versions beside it, scoped to a client, grouped by campaign.
 *
 * It does not create a second content system. Writing an item still goes
 * through `delivery-content.service`, which owns the stage machine; what lives
 * here is reading, and the one write that is genuinely social — starting a new
 * idea inside a client's social section, where the project and the campaign
 * are the context rather than the subject.
 */

const itemSelect = {
  id: true,
  clientId: true,
  projectId: true,
  channel: true,
  title: true,
  brief: true,
  stage: true,
  scheduledFor: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true } },
  campaign: { select: { id: true, name: true } },
  pillar: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, code: true } },
  socialPosts: {
    orderBy: { order: "asc" },
    select: {
      id: true,
      provider: true,
      type: true,
      status: true,
      caption: true,
      scheduledFor: true,
      publishedAt: true,
      externalUrl: true,
      lastError: true,
      aiDraftedAt: true,
      account: { select: { id: true, name: true, status: true } },
      media: {
        orderBy: { order: "asc" },
        take: 1,
        select: { media: { select: { id: true, url: true, type: true } } },
      },
      _count: { select: { media: true } },
    },
  },
  approvals: {
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, status: true, currentVersion: true },
  },
} satisfies Prisma.ContentCalendarItemSelect;

export type SocialContentItem = Prisma.ContentCalendarItemGetPayload<{ select: typeof itemSelect }>;

export type SocialContentFilters = {
  clientId: string | null;
  campaignId?: string | null;
  pillarId?: string | null;
  stage?: ContentStage | null;
  search?: string | null;
};

export async function listContentItems(
  actor: Actor,
  filters: SocialContentFilters,
): Promise<SocialContentItem[]> {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, filters.clientId);

  return db.contentCalendarItem.findMany({
    where: {
      clientId: scope,
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
      ...(filters.pillarId ? { pillarId: filters.pillarId } : {}),
      ...(filters.stage ? { stage: filters.stage } : {}),
      ...(filters.search
        ? { title: { contains: filters.search, mode: "insensitive" as const } }
        : {}),
    },
    orderBy: [{ scheduledFor: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: itemSelect,
  });
}

export async function getContentItem(actor: Actor, id: string): Promise<SocialContentItem> {
  requirePermission(actor, "social.view");

  const item = await db.contentCalendarItem.findUnique({ where: { id }, select: itemSelect });
  if (!item) throw new NotFoundError("That content item does not exist.");
  await resolveClientScope(actor, item.clientId);
  return item;
}

/**
 * Start a new idea inside a client's social section.
 *
 * The difference from `saveContentItem` is the context: here the client is
 * known and the project is chosen from that client's projects, rather than the
 * project being the thing you navigated to. The client is still taken from the
 * project rather than from the caller — the same rule, enforced the same way.
 */
export async function createSocialContent(
  actor: Actor,
  input: {
    clientId: string;
    projectId: string;
    title: string;
    brief: string | null;
    campaignId: string | null;
    pillarId?: string | null;
    ownerId: string | null;
    scheduledFor: Date | null;
  },
): Promise<{ id: string }> {
  requirePermission(actor, "social.create");
  const scope = await resolveClientScope(actor, input.clientId);

  const project = await db.project.findFirst({
    where: { id: input.projectId, clientId: scope },
    select: { id: true, clientId: true },
  });
  if (!project) throw new ValidationError("Choose a project belonging to this client.");

  if (input.campaignId) {
    // A campaign belonging to someone else would silently put this client's
    // work under another client's reporting.
    const campaign = await db.campaign.findFirst({
      where: { id: input.campaignId, clientId: scope },
      select: { id: true },
    });
    if (!campaign) throw new ValidationError("That campaign does not belong to this client.");
  }

  // A pillar is the client's own, like the campaign above.
  await assertPillarForClient(input.pillarId, scope);

  if (input.ownerId) {
    const owner = await db.user.findFirst({
      where: { id: input.ownerId, type: "STAFF" },
      select: { id: true },
    });
    if (!owner) throw new ValidationError("That owner is not a member of staff.");
  }

  return withAudit(
    {
      actor,
      action: "CREATE",
      entityType: "ContentCalendarItem",
      entityId: input.title,
      after: { clientId: scope, campaignId: input.campaignId, pillarId: input.pillarId ?? null, source: "social" },
    },
    (tx) =>
      tx.contentCalendarItem.create({
        data: {
          projectId: project.id,
          clientId: project.clientId,
          // The item's own channel is the first platform it is written for;
          // the platform versions below carry the rest. Kept because the
          // delivery calendar groups by it.
          channel: "INSTAGRAM",
          title: input.title,
          brief: input.brief,
          campaignId: input.campaignId,
          pillarId: input.pillarId ?? null,
          ownerId: input.ownerId,
          scheduledFor: input.scheduledFor,
          stage: "DRAFT",
        },
        select: { id: true },
      }),
  );
}

/** The pickers a social content form needs, all scoped to the one client. */
export async function contentFormOptions(actor: Actor, clientId: string) {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, clientId);

  const [projects, campaigns, accounts, staff, pillars] = await Promise.all([
    db.project.findMany({
      where: { clientId: scope, status: { in: ["PLANNING", "ACTIVE"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    db.campaign.findMany({
      where: { clientId: scope },
      orderBy: { startsAt: "desc" },
      select: { id: true, name: true, status: true },
    }),
    db.socialAccount.findMany({
      where: { clientId: scope, status: { not: "DISCONNECTED" } },
      orderBy: { provider: "asc" },
      select: { id: true, provider: true, name: true, status: true },
    }),
    db.user.findMany({
      where: { type: "STAFF", status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.contentPillar.findMany({
      where: { clientId: scope, archivedAt: null },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return { projects, campaigns, accounts, staff, pillars };
}

/**
 * File an idea under a pillar, or take it out of one.
 *
 * A pillar is the agency's own filing, not copy the client approved, so
 * changing it does not reopen approval the way editing a caption does.
 */
export async function setContentPillar(actor: Actor, itemId: string, pillarId: string | null) {
  requirePermission(actor, "social.edit");
  const item = await db.contentCalendarItem.findUnique({
    where: { id: itemId },
    select: { id: true, clientId: true, pillarId: true },
  });
  if (!item) throw new NotFoundError("That content item does not exist.");
  await resolveClientScope(actor, item.clientId);
  await assertPillarForClient(pillarId, item.clientId, item.pillarId);

  return withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "ContentCalendarItem",
      entityId: itemId,
      before: { pillarId: item.pillarId },
      after: { pillarId },
    },
    (tx) =>
      tx.contentCalendarItem.update({
        where: { id: itemId },
        data: { pillarId },
        select: { id: true, pillarId: true },
      }),
  );
}

/**
 * Give an idea to someone, or take it off them.
 *
 * Who is working on it is agency bookkeeping, not copy anyone approved, so it
 * reopens nothing. The owner must be active staff — never a portal user.
 */
export async function setContentOwner(actor: Actor, itemId: string, ownerId: string | null) {
  requirePermission(actor, "social.edit");
  const item = await db.contentCalendarItem.findUnique({
    where: { id: itemId },
    select: { id: true, clientId: true, ownerId: true },
  });
  if (!item) throw new NotFoundError("That content item does not exist.");
  await resolveClientScope(actor, item.clientId);

  if (ownerId) {
    const owner = await db.user.findFirst({ where: { id: ownerId, type: "STAFF", status: "ACTIVE" }, select: { id: true } });
    if (!owner) throw new ValidationError("That person is not active staff.");
  }
  if (item.ownerId === ownerId) return { id: item.id, ownerId };

  return withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "ContentCalendarItem",
      entityId: itemId,
      before: { ownerId: item.ownerId },
      after: { ownerId },
    },
    (tx) => tx.contentCalendarItem.update({ where: { id: itemId }, data: { ownerId }, select: { id: true, ownerId: true } }),
  );
}

/** Versions that may go with an idea when it is deleted as a draft. */
const DISPOSABLE_POST_STATUSES = ["DRAFT", "CANCELLED"] as const;

/**
 * Delete an idea that never got anywhere.
 *
 * Drafts only: an idea at idea or draft stage, never sent to the client, whose
 * versions are drafts or cancelled and never reached a platform. Anything the
 * client has seen, or that may be live, is history and stays.
 */
export async function deleteDraftContent(actor: Actor, itemId: string) {
  requirePermission(actor, "social.delete");
  const item = await db.contentCalendarItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      clientId: true,
      title: true,
      stage: true,
      _count: { select: { approvals: true } },
      socialPosts: { select: { status: true, externalPostId: true, attemptCount: true } },
    },
  });
  if (!item) throw new NotFoundError("That content item does not exist.");
  await resolveClientScope(actor, item.clientId);

  if (item.stage !== "IDEA" && item.stage !== "DRAFT") {
    throw new ConflictError("Only ideas and drafts can be deleted. This one has moved on.");
  }
  if (item._count.approvals > 0) {
    throw new ConflictError("This has been in front of the client. Its history stays.");
  }
  const blocking = item.socialPosts.find(
    (post) =>
      !(DISPOSABLE_POST_STATUSES as readonly string[]).includes(post.status) || post.externalPostId || post.attemptCount > 0,
  );
  if (blocking) throw new ConflictError("A version of this has been scheduled or sent to a platform. It stays.");

  await withAudit(
    {
      actor,
      action: "DELETE",
      entityType: "ContentCalendarItem",
      entityId: itemId,
      before: { title: item.title, stage: item.stage, versions: item.socialPosts.length },
    },
    (tx) => tx.contentCalendarItem.delete({ where: { id: itemId }, select: { id: true } }),
  );
}
