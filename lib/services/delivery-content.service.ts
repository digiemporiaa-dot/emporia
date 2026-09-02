import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { visibilityFilter } from "@/lib/services/project.service";
import { contentTransitionError, requiresSchedule } from "@/lib/projects/lifecycle";
import type { Actor } from "@/lib/actor/types";
import type { ApprovalStatus, ContentChannel, ContentStage } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ApprovalInput,
  ContentItemInput,
} from "@/lib/validation/project";

/**
 * Content calendar and creative approvals.
 *
 * A content item belongs to a project and carries its client id directly. That
 * denormalised `clientId` is the column the portal will filter on in Phase 10,
 * so it is written from the project at creation and never accepted from a
 * caller.
 *
 * Approvals keep every version: an approved version is a record of what was
 * approved, so a new round creates a new version rather than editing the last
 * one.
 */

// ---------------------------------------------------------------------------
// Content calendar
// ---------------------------------------------------------------------------

/** Only items on projects the actor can see. */
function contentScope(actor: Actor): Prisma.ContentCalendarItemWhereInput {
  return { project: visibilityFilter(actor) };
}

export type ContentListParams = {
  from?: Date | null;
  to?: Date | null;
  channel?: ContentChannel | null;
  stage?: ContentStage | null;
  projectId?: string | null;
  clientId?: string | null;
  ownerId?: string | null;
};

export async function listContent(actor: Actor, params: ContentListParams = {}) {
  requirePermission(actor, "content.view");

  const where: Prisma.ContentCalendarItemWhereInput = {
    AND: [
      contentScope(actor),
      ...(params.from || params.to
        ? [
            {
              scheduledFor: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            },
          ]
        : []),
    ],
    ...(params.channel ? { channel: params.channel } : {}),
    ...(params.stage ? { stage: params.stage } : {}),
    ...(params.projectId ? { projectId: params.projectId } : {}),
    ...(params.clientId ? { clientId: params.clientId } : {}),
    ...(params.ownerId ? { ownerId: params.ownerId } : {}),
  };

  return db.contentCalendarItem.findMany({
    where,
    orderBy: [{ scheduledFor: "asc" }, { createdAt: "desc" }],
    take: 500,
    select: {
      id: true,
      channel: true,
      title: true,
      stage: true,
      scheduledFor: true,
      publishedAt: true,
      owner: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      project: { select: { id: true, code: true, name: true } },
      _count: { select: { approvals: true } },
    },
  });
}

export async function getContentItem(actor: Actor, id: string) {
  requirePermission(actor, "content.view");

  const item = await db.contentCalendarItem.findFirst({
    where: { AND: [{ id }, contentScope(actor)] },
    select: {
      id: true,
      channel: true,
      title: true,
      brief: true,
      stage: true,
      scheduledFor: true,
      publishedAt: true,
      createdAt: true,
      projectId: true,
      ownerId: true,
      mediaId: true,
      media: { select: { id: true, url: true, filename: true, type: true, alt: true } },
      owner: { select: { id: true, name: true } },
      client: { select: { id: true, name: true } },
      project: { select: { id: true, code: true, name: true } },
      approvals: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          currentVersion: true,
          createdAt: true,
          decidedAt: true,
        },
      },
    },
  });

  if (!item) throw new NotFoundError("That content item does not exist.");
  return item;
}

export async function saveContentItem(actor: Actor, id: string | null, input: ContentItemInput) {
  requirePermission(actor, id ? "content.edit" : "content.create");

  // The client id comes from the project, never from the caller: it is the
  // column portal isolation will filter on.
  const project = await db.project.findFirst({
    where: { AND: [{ id: input.projectId }, visibilityFilter(actor)] },
    select: { id: true, clientId: true },
  });
  if (!project) throw new ValidationError("That project does not exist.");

  return withAudit(
    {
      actor,
      action: id ? "UPDATE" : "CREATE",
      entityType: "ContentCalendarItem",
      entityId: id ?? input.title,
    },
    (tx) => {
      const data = {
        channel: input.channel,
        title: input.title,
        brief: input.brief ?? null,
        ownerId: input.ownerId || null,
        scheduledFor: input.scheduledFor ?? null,
        mediaId: input.mediaId || null,
      };

      return id
        ? tx.contentCalendarItem.update({ where: { id }, data, select: { id: true } })
        : tx.contentCalendarItem.create({
            data: { ...data, projectId: project.id, clientId: project.clientId },
            select: { id: true },
          });
    },
  );
}

/**
 * Move an item through the workflow.
 *
 * The stage order is enforced here rather than in the UI: scheduling something
 * that was never approved, or marking something published that was never
 * scheduled, would make the calendar a record of nothing.
 */
export async function setContentStage(actor: Actor, id: string, stage: ContentStage) {
  requirePermission(actor, stage === "PUBLISHED" ? "content.publish" : "content.edit");

  const item = await db.contentCalendarItem.findFirst({
    where: { AND: [{ id }, contentScope(actor)] },
    select: { id: true, stage: true, scheduledFor: true, projectId: true },
  });
  if (!item) throw new NotFoundError("That content item does not exist.");

  const error = contentTransitionError(item.stage, stage);
  if (error) throw new ValidationError(error);

  if (requiresSchedule(stage) && !item.scheduledFor) {
    throw new ValidationError("Set a scheduled date before scheduling or publishing this item.");
  }

  return withAudit(
    {
      actor,
      action: stage === "PUBLISHED" ? "PUBLISH" : "STATUS_CHANGE",
      entityType: "ContentCalendarItem",
      entityId: id,
      before: { stage: item.stage },
    },
    (tx) =>
      tx.contentCalendarItem.update({
        where: { id },
        data: {
          stage,
          // Publication is a fact with a time; clearing it on the way back out
          // keeps "published" from meaning two different things.
          publishedAt: stage === "PUBLISHED" ? new Date() : null,
        },
        select: { id: true, stage: true },
      }),
  );
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export async function listApprovals(actor: Actor, status?: ApprovalStatus | null) {
  requirePermission(actor, "approvals.view");

  return db.approval.findMany({
    where: {
      ...(status ? { status } : {}),
      OR: [
        { project: visibilityFilter(actor) },
        { contentItem: { project: visibilityFilter(actor) } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      title: true,
      status: true,
      currentVersion: true,
      createdAt: true,
      decidedAt: true,
      client: { select: { id: true, name: true } },
      project: { select: { id: true, code: true, name: true } },
      contentItem: { select: { id: true, title: true, channel: true } },
      requestedBy: { select: { id: true, name: true } },
      decidedBy: { select: { id: true, name: true } },
    },
  });
}

export async function getApproval(actor: Actor, id: string) {
  requirePermission(actor, "approvals.view");

  const approval = await db.approval.findFirst({
    where: {
      AND: [
        { id },
        {
          OR: [
            { project: visibilityFilter(actor) },
            { contentItem: { project: visibilityFilter(actor) } },
          ],
        },
      ],
    },
    select: {
      id: true,
      title: true,
      status: true,
      currentVersion: true,
      createdAt: true,
      decidedAt: true,
      client: { select: { id: true, name: true } },
      project: { select: { id: true, code: true, name: true } },
      contentItem: { select: { id: true, title: true, channel: true, stage: true } },
      requestedBy: { select: { id: true, name: true } },
      decidedBy: { select: { id: true, name: true } },
      versions: {
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          notes: true,
          status: true,
          feedback: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true } },
          media: { select: { id: true, url: true, filename: true, type: true, alt: true } },
        },
      },
    },
  });

  if (!approval) throw new NotFoundError("That approval does not exist.");
  return approval;
}

/**
 * Open an approval, with its first version.
 *
 * An approval must hang off a project or a content item, because that is where
 * its client comes from — an approval with no owner is not something a client
 * could ever be shown.
 */
export async function requestApproval(actor: Actor, input: ApprovalInput) {
  requirePermission(actor, "approvals.request");

  if (!input.projectId && !input.contentItemId) {
    throw new ValidationError("An approval must belong to a project or a content item.");
  }

  let clientId: string | null = null;
  let projectId: string | null = input.projectId || null;

  if (input.contentItemId) {
    const item = await db.contentCalendarItem.findFirst({
      where: { AND: [{ id: input.contentItemId }, contentScope(actor)] },
      select: { id: true, clientId: true, projectId: true },
    });
    if (!item) throw new ValidationError("That content item does not exist.");
    clientId = item.clientId;
    projectId = projectId ?? item.projectId;
  } else if (projectId) {
    const project = await db.project.findFirst({
      where: { AND: [{ id: projectId }, visibilityFilter(actor)] },
      select: { id: true, clientId: true },
    });
    if (!project) throw new ValidationError("That project does not exist.");
    clientId = project.clientId;
  }

  if (!clientId) throw new ValidationError("That approval has no client.");

  return withAudit(
    { actor, action: "CREATE", entityType: "Approval", entityId: input.title },
    async (tx) => {
      const approval = await tx.approval.create({
        data: {
          clientId,
          projectId,
          contentItemId: input.contentItemId || null,
          title: input.title,
          status: "PENDING",
          currentVersion: 1,
          requestedById: actor.userId,
        },
        select: { id: true },
      });

      await tx.approvalVersion.create({
        data: {
          approvalId: approval.id,
          version: 1,
          notes: input.notes ?? null,
          mediaId: input.mediaId || null,
          status: "PENDING",
          createdById: actor.userId,
        },
      });

      return approval;
    },
  );
}

/**
 * Add a new version after changes were requested.
 *
 * Versions are append-only. Editing the version a client already commented on
 * would rewrite the thing they responded to.
 */
export async function addApprovalVersion(
  actor: Actor,
  approvalId: string,
  notes: string | null,
  mediaId: string | null = null,
) {
  requirePermission(actor, "approvals.request");

  const approval = await db.approval.findFirst({
    where: {
      AND: [
        { id: approvalId },
        {
          OR: [
            { project: visibilityFilter(actor) },
            { contentItem: { project: visibilityFilter(actor) } },
          ],
        },
      ],
    },
    select: { id: true, status: true, currentVersion: true },
  });

  if (!approval) throw new NotFoundError("That approval does not exist.");
  if (approval.status === "APPROVED") {
    throw new ConflictError("That approval is already approved. Open a new one instead.");
  }

  return withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "Approval",
      entityId: approvalId,
      before: { version: approval.currentVersion, status: approval.status },
    },
    async (tx) => {
      const version = approval.currentVersion + 1;

      await tx.approvalVersion.create({
        data: {
          approvalId,
          version,
          notes,
          mediaId,
          status: "PENDING",
          createdById: actor.userId,
        },
      });

      return tx.approval.update({
        where: { id: approvalId },
        data: { status: "PENDING", currentVersion: version, decidedById: null, decidedAt: null },
        select: { id: true, currentVersion: true },
      });
    },
  );
}

/**
 * Record a decision on the current version.
 *
 * Staff decide internally here; the client's own decision comes through the
 * portal in Phase 10 and lands on the same rows.
 */
export async function decideApproval(
  actor: Actor,
  approvalId: string,
  decision: Exclude<ApprovalStatus, "PENDING">,
  feedback: string | null,
) {
  requirePermission(actor, "approvals.decide");

  const approval = await db.approval.findFirst({
    where: {
      AND: [
        { id: approvalId },
        {
          OR: [
            { project: visibilityFilter(actor) },
            { contentItem: { project: visibilityFilter(actor) } },
          ],
        },
      ],
    },
    select: { id: true, status: true, currentVersion: true },
  });

  if (!approval) throw new NotFoundError("That approval does not exist.");
  if (approval.status !== "PENDING") {
    throw new ConflictError("That version has already been decided.");
  }
  if (decision === "CHANGES_REQUESTED" && !feedback) {
    throw new ValidationError("Say what needs to change.");
  }

  return withAudit(
    {
      actor,
      action: "STATUS_CHANGE",
      entityType: "Approval",
      entityId: approvalId,
      before: { status: approval.status, version: approval.currentVersion },
    },
    async (tx) => {
      await tx.approvalVersion.update({
        where: {
          approvalId_version: { approvalId, version: approval.currentVersion },
        },
        data: { status: decision, feedback },
      });

      return tx.approval.update({
        where: { id: approvalId },
        data: {
          status: decision,
          decidedById: actor.userId,
          decidedAt: new Date(),
        },
        select: { id: true, status: true },
      });
    },
  );
}
