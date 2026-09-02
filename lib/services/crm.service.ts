import "server-only";
import { db, type DbClient } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { can, requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { mergeScoringConfig, scoreLead, type ScoringConfig } from "@/lib/crm/scoring";
import { transitionError } from "@/lib/crm/pipeline";
import type { Actor } from "@/lib/actor/types";
import type { LeadStatus, Priority, TaskStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/**
 * CRM.
 *
 * The rule that matters here is row-level visibility: `leads.view` shows a
 * user their own leads, `leads.view.team` shows everyone's. That is resolved in
 * exactly one place — `visibilityFilter` — and every read and write goes
 * through it, so there is no query that can accidentally return another rep's
 * pipeline (CLAUDE.md 8).
 */

/**
 * The single definition of which leads an actor may see.
 *
 * Returns a Prisma filter rather than a boolean, so it composes into any query
 * instead of being re-implemented per call site.
 */
export function visibilityFilter(actor: Actor): Prisma.LeadWhereInput {
  if (actor.roleName === "SUPER_ADMIN" || can(actor, "leads.view.team")) return {};
  if (!can(actor, "leads.view")) {
    // Callers should have checked already; this makes the failure mode a
    // matching-nothing filter rather than an accidental full table scan.
    return { id: "__none__" };
  }
  return { assignedToId: actor.userId };
}

/** True when the actor may see every lead rather than only their own. */
export function seesWholeTeam(actor: Actor): boolean {
  return actor.roleName === "SUPER_ADMIN" || can(actor, "leads.view.team");
}

export async function scoringConfig(): Promise<ScoringConfig> {
  const setting = await db.siteSetting.findUnique({
    where: { key: "crm.scoring" },
    select: { value: true },
  });
  return mergeScoringConfig(setting?.value ?? null);
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export type LeadListParams = {
  page?: number;
  perPage?: number;
  search?: string;
  status?: LeadStatus | null;
  priority?: Priority | null;
  sourceId?: string | null;
  serviceId?: string | null;
  cityId?: string | null;
  assignedToId?: string | null;
  /** "unassigned" is a distinct filter from "any assignee". */
  unassigned?: boolean;
  sort?: "createdAt" | "score" | "name" | "status";
  direction?: "asc" | "desc";
};

const MAX_PER_PAGE = 100;

export async function listLeads(actor: Actor, params: LeadListParams = {}) {
  requirePermission(actor, "leads.view");

  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(5, params.perPage ?? 25));
  const sort = params.sort ?? "createdAt";
  const direction = params.direction ?? "desc";

  const search = params.search?.trim();

  const where: Prisma.LeadWhereInput = {
    deletedAt: null,
    // Row-level scoping is applied first and cannot be overridden by a filter.
    AND: [
      visibilityFilter(actor),
      ...(search
        ? [
            {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
                { phone: { contains: search } },
                { company: { contains: search, mode: "insensitive" as const } },
              ],
            },
          ]
        : []),
    ],
    ...(params.status ? { status: params.status } : {}),
    ...(params.priority ? { priority: params.priority } : {}),
    ...(params.sourceId ? { sourceId: params.sourceId } : {}),
    ...(params.serviceId ? { serviceId: params.serviceId } : {}),
    ...(params.cityId ? { cityId: params.cityId } : {}),
    ...(params.unassigned
      ? { assignedToId: null }
      : params.assignedToId
        ? { assignedToId: params.assignedToId }
        : {}),
  };

  const orderBy: Prisma.LeadOrderByWithRelationInput =
    sort === "name"
      ? { name: direction }
      : sort === "score"
        ? { score: direction }
        : sort === "status"
          ? { status: direction }
          : { createdAt: direction };

  // Server-side pagination; the browser never receives the whole table
  // (CLAUDE.md 12).
  const [rows, total] = await Promise.all([
    db.lead.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        company: true,
        status: true,
        priority: true,
        score: true,
        budget: true,
        currency: true,
        createdAt: true,
        source: { select: { name: true, slug: true } },
        service: { select: { name: true } },
        city: { select: { name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    }),
    db.lead.count({ where }),
  ]);

  return {
    rows: rows.map((row) => ({
      ...row,
      // Money crosses the boundary as a string, never a Decimal or a number.
      budget: row.budget ? row.budget.toString() : null,
    })),
    total,
    page,
    perPage,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
  };
}

/** Counts per pipeline stage, respecting the same visibility rule. */
export async function pipelineCounts(actor: Actor) {
  requirePermission(actor, "leads.view");

  const rows = await db.lead.groupBy({
    by: ["status"],
    where: { deletedAt: null, AND: [visibilityFilter(actor)] },
    _count: { _all: true },
  });

  const counts: Partial<Record<LeadStatus, number>> = {};
  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}

export async function boardLeads(actor: Actor, limitPerStage = 50) {
  requirePermission(actor, "leads.view");

  return db.lead.findMany({
    where: {
      deletedAt: null,
      status: { in: ["NEW", "CONTACTED", "QUALIFIED", "PROPOSAL", "NEGOTIATION"] },
      AND: [visibilityFilter(actor)],
    },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    take: limitPerStage * 5,
    select: {
      id: true,
      name: true,
      company: true,
      status: true,
      priority: true,
      score: true,
      createdAt: true,
      assignedTo: { select: { id: true, name: true } },
      service: { select: { name: true } },
      city: { select: { name: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Single lead
// ---------------------------------------------------------------------------

/**
 * Load a lead the actor is allowed to see.
 *
 * Resolved by id AND the visibility filter in one query, so a lead belonging to
 * another rep is indistinguishable from one that does not exist — no timing or
 * error-message difference to probe with.
 */
export async function getLead(actor: Actor, id: string) {
  requirePermission(actor, "leads.view");

  const lead = await db.lead.findFirst({
    where: { id, deletedAt: null, AND: [visibilityFilter(actor)] },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      company: true,
      message: true,
      budget: true,
      currency: true,
      status: true,
      priority: true,
      score: true,
      landingPath: true,
      referrer: true,
      device: true,
      createdAt: true,
      updatedAt: true,
      convertedAt: true,
      source: { select: { id: true, name: true, slug: true } },
      service: { select: { id: true, name: true, slug: true } },
      city: { select: { id: true, name: true, slug: true } },
      package: { select: { id: true, name: true } },
      popup: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      firstTouch: {
        select: { source: true, medium: true, campaign: true, term: true, content: true, landingPath: true, referrer: true, occurredAt: true },
      },
      lastTouch: {
        select: { source: true, medium: true, campaign: true, term: true, content: true, landingPath: true, referrer: true, occurredAt: true },
      },
      tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          type: true,
          summary: true,
          meta: true,
          createdAt: true,
          actor: { select: { id: true, name: true } },
        },
      },
      notes: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { id: true, name: true } },
        },
      },
      tasks: {
        orderBy: [{ status: "asc" }, { dueAt: "asc" }],
        select: {
          id: true,
          title: true,
          detail: true,
          dueAt: true,
          status: true,
          priority: true,
          completedAt: true,
          assignee: { select: { id: true, name: true } },
        },
      },
      assignments: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          reason: true,
          createdAt: true,
          fromUser: { select: { id: true, name: true } },
          toUser: { select: { id: true, name: true } },
          assignedBy: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!lead) throw new NotFoundError("That lead does not exist.");

  return { ...lead, budget: lead.budget ? lead.budget.toString() : null };
}

/** Assert the actor may act on this lead, without loading the whole record. */
async function assertVisible(actor: Actor, id: string): Promise<void> {
  const found = await db.lead.findFirst({
    where: { id, deletedAt: null, AND: [visibilityFilter(actor)] },
    select: { id: true },
  });
  if (!found) throw new NotFoundError("That lead does not exist.");
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export async function changeStatus(
  actor: Actor,
  id: string,
  status: LeadStatus,
  note?: string | null,
) {
  requirePermission(actor, "leads.edit");
  await assertVisible(actor, id);

  const before = await db.lead.findUniqueOrThrow({
    where: { id },
    select: { status: true, name: true },
  });

  const error = transitionError(before.status, status);
  if (error) throw new ValidationError(error);

  return withAudit(
    { actor, action: "STATUS_CHANGE", entityType: "Lead", entityId: id, before },
    async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: {
          status,
          ...(status === "WON" ? { convertedAt: new Date() } : {}),
        },
      });

      // Status history lives in the activity timeline rather than a separate
      // table, so the timeline is genuinely complete.
      await tx.leadActivity.create({
        data: {
          leadId: id,
          actorId: actor.type === "SYSTEM" ? null : actor.userId,
          type: "STATUS_CHANGED",
          summary: `Status changed from ${before.status} to ${status}.`,
          meta: { from: before.status, to: status, note: note ?? null },
        },
      });

      return updated;
    },
  );
}

export async function assignLead(
  actor: Actor,
  id: string,
  toUserId: string | null,
  reason?: string | null,
) {
  requirePermission(actor, "leads.assign");
  await assertVisible(actor, id);

  const before = await db.lead.findUniqueOrThrow({
    where: { id },
    select: { assignedToId: true },
  });

  if (before.assignedToId === toUserId) {
    throw new ValidationError("That lead is already assigned to that person.");
  }

  if (toUserId) {
    const target = await db.user.findFirst({
      where: { id: toUserId, type: "STAFF", status: "ACTIVE" },
      select: { id: true, name: true },
    });
    if (!target) throw new ValidationError("That person cannot be assigned leads.");
  }

  return withAudit(
    { actor, action: "ASSIGN", entityType: "Lead", entityId: id, before },
    async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data: { assignedToId: toUserId },
      });

      // The Lead row holds the current owner; LeadAssignment is the history of
      // every handoff, which is what makes reassignment auditable.
      if (toUserId) {
        await tx.leadAssignment.create({
          data: {
            leadId: id,
            fromUserId: before.assignedToId,
            toUserId,
            assignedById: actor.userId,
            reason: reason ?? null,
          },
        });
      }

      await tx.leadActivity.create({
        data: {
          leadId: id,
          actorId: actor.type === "SYSTEM" ? null : actor.userId,
          type: "ASSIGNED",
          summary: toUserId ? "Lead assigned." : "Lead unassigned.",
          meta: { from: before.assignedToId, to: toUserId, reason: reason ?? null },
        },
      });

      return updated;
    },
  );
}

export async function setPriority(actor: Actor, id: string, priority: Priority) {
  requirePermission(actor, "leads.edit");
  await assertVisible(actor, id);

  return withAudit(
    { actor, action: "UPDATE", entityType: "Lead", entityId: id },
    (tx) => tx.lead.update({ where: { id }, data: { priority } }),
  );
}

export async function addNote(actor: Actor, leadId: string, body: string) {
  requirePermission(actor, "leads.edit");
  await assertVisible(actor, leadId);

  return db.$transaction(async (tx) => {
    const note = await tx.leadNote.create({
      data: { leadId, authorId: actor.userId, body },
    });

    await tx.leadActivity.create({
      data: {
        leadId,
        actorId: actor.userId,
        type: "NOTE_ADDED",
        summary: "Note added.",
      },
    });

    await record(
      { actor, action: "CREATE", entityType: "LeadNote", entityId: note.id, after: note },
      tx,
    );

    return note;
  });
}

export type LeadTaskInput = {
  leadId: string;
  title: string;
  detail?: string | null;
  dueAt: Date;
  assigneeId: string;
  priority?: Priority;
};

export async function addTask(actor: Actor, input: LeadTaskInput) {
  requirePermission(actor, "leads.edit");
  await assertVisible(actor, input.leadId);

  return db.$transaction(async (tx) => {
    const task = await tx.leadTask.create({
      data: {
        leadId: input.leadId,
        title: input.title,
        detail: input.detail ?? null,
        dueAt: input.dueAt,
        assigneeId: input.assigneeId,
        priority: input.priority ?? "MEDIUM",
        status: "TODO",
      },
    });

    await tx.leadActivity.create({
      data: {
        leadId: input.leadId,
        actorId: actor.userId,
        type: "TASK_CREATED",
        summary: `Follow-up scheduled: ${input.title}`,
        meta: { taskId: task.id, dueAt: input.dueAt.toISOString() },
      },
    });

    await record(
      { actor, action: "CREATE", entityType: "LeadTask", entityId: task.id, after: task },
      tx,
    );

    return task;
  });
}

export async function completeTask(actor: Actor, taskId: string) {
  requirePermission(actor, "leads.edit");

  const task = await db.leadTask.findUnique({
    where: { id: taskId },
    select: { id: true, leadId: true, title: true, status: true },
  });
  if (!task) throw new NotFoundError("That task does not exist.");
  await assertVisible(actor, task.leadId);

  if (task.status === "DONE") return task;

  return db.$transaction(async (tx) => {
    const updated = await tx.leadTask.update({
      where: { id: taskId },
      data: { status: "DONE" as TaskStatus, completedAt: new Date() },
    });

    await tx.leadActivity.create({
      data: {
        leadId: task.leadId,
        actorId: actor.userId,
        type: "TASK_COMPLETED",
        summary: `Follow-up completed: ${task.title}`,
        meta: { taskId },
      },
    });

    return updated;
  });
}

/**
 * Recompute a lead's score from its current facts.
 *
 * Exposed because scoring is configurable: retuning the weights should let an
 * admin re-score existing leads rather than leaving them on old numbers.
 */
export async function rescoreLead(actor: Actor, id: string) {
  requirePermission(actor, "leads.edit");
  await assertVisible(actor, id);

  const [lead, config] = await Promise.all([
    db.lead.findUniqueOrThrow({
      where: { id },
      select: {
        score: true,
        budget: true,
        phone: true,
        company: true,
        message: true,
        packageId: true,
        source: { select: { slug: true } },
        service: { select: { slug: true } },
        city: { select: { slug: true } },
      },
    }),
    scoringConfig(),
  ]);

  const result = scoreLead(
    {
      budget: lead.budget?.toString() ?? null,
      sourceSlug: lead.source.slug,
      serviceSlug: lead.service?.slug ?? null,
      citySlug: lead.city?.slug ?? null,
      phone: lead.phone,
      company: lead.company,
      message: lead.message,
      packageId: lead.packageId,
    },
    config,
  );

  if (result.score === lead.score) return result;

  await db.$transaction(async (tx) => {
    await tx.lead.update({ where: { id }, data: { score: result.score } });
    await tx.leadActivity.create({
      data: {
        leadId: id,
        actorId: actor.userId,
        type: "SCORE_CHANGED",
        summary: `Score recalculated: ${lead.score} → ${result.score}.`,
        meta: { from: lead.score, to: result.score, factors: result.factors },
      },
    });
  });

  return result;
}

/**
 * Score a lead at capture time, inside the caller's transaction.
 *
 * Used by the public capture paths so a lead is scored the moment it arrives,
 * not by a later sweep.
 */
export async function scoreOnCapture(
  tx: DbClient,
  leadId: string,
  facts: Parameters<typeof scoreLead>[0],
  config: ScoringConfig,
): Promise<number> {
  const result = scoreLead(facts, config);

  await tx.lead.update({ where: { id: leadId }, data: { score: result.score } });

  if (result.factors.length > 0) {
    await tx.leadActivity.create({
      data: {
        leadId,
        type: "SCORE_CHANGED",
        summary: `Scored ${result.score} (${result.band.toLowerCase()}).`,
        meta: { score: result.score, band: result.band, factors: result.factors },
      },
    });
  }

  return result.score;
}

/** Staff who can be assigned leads. */
export async function assignableUsers(actor: Actor) {
  requirePermission(actor, "leads.view");

  return db.user.findMany({
    where: { type: "STAFF", status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: { select: { name: true } } },
  });
}

// ---------------------------------------------------------------------------
// Automatic assignment at capture
// ---------------------------------------------------------------------------

/**
 * Choose who a newly captured lead goes to.
 *
 * Least-loaded first among active staff who hold `leads.view` but not
 * `leads.view.team` — that is, the reps who work a personal pipeline rather
 * than managers who oversee everyone's. Ties break on who has waited longest
 * for a lead, so a quiet rep is not starved by ordering.
 *
 * Returns null when there is nobody to assign to, and the lead stays
 * unassigned rather than being parked on an arbitrary person. The rules engine
 * in Phase 15 can override this; it is not a placeholder for it.
 */
export async function pickAssignee(): Promise<string | null> {
  const setting = await db.siteSetting.findUnique({
    where: { key: "crm.autoAssign" },
    select: { value: true },
  });

  // Opt-out is explicit: absent config means assignment is on.
  if (setting && typeof setting.value === "object" && setting.value !== null) {
    const config = setting.value as { enabled?: unknown };
    if (config.enabled === false) return null;
  }

  const candidates = await db.user.findMany({
    where: {
      type: "STAFF",
      status: "ACTIVE",
      role: {
        permissions: { some: { permission: { key: "leads.view" } } },
        NOT: { permissions: { some: { permission: { key: "leads.view.team" } } } },
      },
    },
    select: {
      id: true,
      _count: { select: { assignedLeads: { where: { deletedAt: null, status: { notIn: ["WON", "LOST"] } } } } },
      assignedLeads: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    if (a._count.assignedLeads !== b._count.assignedLeads) {
      return a._count.assignedLeads - b._count.assignedLeads;
    }
    const aLast = a.assignedLeads[0]?.createdAt?.getTime() ?? 0;
    const bLast = b.assignedLeads[0]?.createdAt?.getTime() ?? 0;
    return aLast - bLast;
  });

  return sorted[0]?.id ?? null;
}

/**
 * Assign at capture time, inside the caller's transaction.
 *
 * Writes the assignment history and the timeline entry, so an automatically
 * assigned lead looks the same in the audit trail as a manually assigned one —
 * with a null `assignedById`, which is what marks it as automatic.
 */
export async function assignOnCapture(
  tx: DbClient,
  leadId: string,
  assigneeId: string,
): Promise<void> {
  await tx.lead.update({ where: { id: leadId }, data: { assignedToId: assigneeId } });

  await tx.leadAssignment.create({
    data: {
      leadId,
      fromUserId: null,
      toUserId: assigneeId,
      assignedById: assigneeId,
      reason: "Automatically assigned on capture (least loaded).",
    },
  });

  await tx.leadActivity.create({
    data: {
      leadId,
      type: "ASSIGNED",
      summary: "Automatically assigned on capture.",
      meta: { automatic: true, toUserId: assigneeId },
    },
  });
}
