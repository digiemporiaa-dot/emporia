import "server-only";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import type { AutomationInput } from "@/lib/validation/automation";
import type { Actor } from "@/lib/actor/types";
import type { WiredTrigger } from "@/lib/automation/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Managing rules.
 *
 * Rules live entirely in the database — a new one is built and switched on in
 * admin, with no deploy. That is the phase's exit criterion, and the reason the
 * trigger, conditions and actions are rows rather than code.
 */

export async function listAutomations(actor: Actor) {
  requirePermission(actor, "automation.view");

  const rows = await db.automation.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      order: true,
      triggers: { select: { type: true } },
      _count: { select: { conditions: true, actions: true } },
    },
  });

  return rows.map((row) => ({
    ...row,
    trigger: (row.triggers[0]?.type ?? null) as WiredTrigger | null,
  }));
}

export async function getAutomation(actor: Actor, id: string) {
  requirePermission(actor, "automation.view");

  const automation = await db.automation.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      order: true,
      triggers: { select: { type: true } },
      conditions: {
        orderBy: { order: "asc" },
        select: { id: true, field: true, operator: true, value: true },
      },
      actions: { orderBy: { order: "asc" }, select: { id: true, type: true, config: true } },
    },
  });

  if (!automation) throw new NotFoundError("That automation does not exist.");

  return { ...automation, trigger: (automation.triggers[0]?.type ?? null) as WiredTrigger | null };
}

export async function createAutomation(actor: Actor, input: AutomationInput) {
  requirePermission(actor, "automation.edit");

  return withAudit(
    { actor, action: "CREATE", entityType: "Automation", entityId: input.name, after: input },
    (tx) =>
      tx.automation.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          isActive: input.isActive,
          order: input.order,
          triggers: { create: { type: input.trigger } },
          conditions: {
            create: input.conditions.map((condition, index) => ({
              field: condition.field,
              operator: condition.operator,
              // A Json column takes any JSON scalar; the cast is through
              // Prisma's own input type rather than `object`.
              value: (condition.value ?? null) as Prisma.InputJsonValue,
              order: index,
            })),
          },
          actions: {
            create: input.actions.map((action, index) => ({
              type: action.type,
              config: action as unknown as Prisma.InputJsonObject,
              order: index,
            })),
          },
        },
        select: { id: true, name: true },
      }),
  );
}

/**
 * Replace a rule's trigger, conditions and actions.
 *
 * The children are deleted and rewritten rather than diffed: they are ordered
 * lists with no identity of their own, and a partial update is how a rule ends
 * up with a stale condition nobody can see in the editor.
 */
export async function updateAutomation(actor: Actor, id: string, input: AutomationInput) {
  requirePermission(actor, "automation.edit");

  const before = await db.automation.findUnique({
    where: { id },
    select: { id: true, name: true, isActive: true },
  });
  if (!before) throw new NotFoundError("That automation does not exist.");

  return withAudit(
    { actor, action: "UPDATE", entityType: "Automation", entityId: id, before, after: input },
    async (tx) => {
      await tx.automationTrigger.deleteMany({ where: { automationId: id } });
      await tx.automationCondition.deleteMany({ where: { automationId: id } });
      await tx.automationAction.deleteMany({ where: { automationId: id } });

      return tx.automation.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description ?? null,
          isActive: input.isActive,
          order: input.order,
          triggers: { create: { type: input.trigger } },
          conditions: {
            create: input.conditions.map((condition, index) => ({
              field: condition.field,
              operator: condition.operator,
              // A Json column takes any JSON scalar; the cast is through
              // Prisma's own input type rather than `object`.
              value: (condition.value ?? null) as Prisma.InputJsonValue,
              order: index,
            })),
          },
          actions: {
            create: input.actions.map((action, index) => ({
              type: action.type,
              config: action as unknown as Prisma.InputJsonObject,
              order: index,
            })),
          },
        },
        select: { id: true, name: true },
      });
    },
  );
}

export async function setAutomationActive(actor: Actor, id: string, isActive: boolean) {
  requirePermission(actor, "automation.edit");

  const before = await db.automation.findUnique({
    where: { id },
    select: { id: true, isActive: true, _count: { select: { actions: true, triggers: true } } },
  });
  if (!before) throw new NotFoundError("That automation does not exist.");

  // Switching on a rule with no trigger or no actions would create something
  // that looks live and does nothing.
  if (isActive && (before._count.triggers === 0 || before._count.actions === 0)) {
    throw new ValidationError("A rule needs a trigger and at least one action before it can run.");
  }

  return withAudit(
    { actor, action: "STATUS_CHANGE", entityType: "Automation", entityId: id, before, after: { isActive } },
    (tx) => tx.automation.update({ where: { id }, data: { isActive }, select: { id: true, isActive: true } }),
  );
}

export async function deleteAutomation(actor: Actor, id: string) {
  requirePermission(actor, "automation.edit");

  const before = await db.automation.findUnique({
    where: { id },
    select: { id: true, name: true, isActive: true },
  });
  if (!before) throw new NotFoundError("That automation does not exist.");
  if (before.isActive) {
    throw new ValidationError("Switch the rule off before deleting it.");
  }

  return withAudit(
    { actor, action: "DELETE", entityType: "Automation", entityId: id, before },
    (tx) => tx.automation.delete({ where: { id }, select: { id: true } }),
  );
}

/**
 * What the rules have actually done.
 *
 * Read straight from the audit trail rather than a second log, so the screen
 * cannot drift from the record that matters (CLAUDE.md 11).
 */
export async function recentRuns(actor: Actor, limit = 50, automationId?: string) {
  requirePermission(actor, "automation.view");

  const rows = await db.auditLog.findMany({
    where: {
      entityType: "Automation",
      action: "UPDATE",
      actorId: null,
      ...(automationId ? { entityId: automationId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, limit)),
    select: { id: true, entityId: true, after: true, createdAt: true },
  });

  const names = new Map(
    (
      await db.automation.findMany({
        where: { id: { in: [...new Set(rows.map((row) => row.entityId))] } },
        select: { id: true, name: true },
      })
    ).map((row) => [row.id, row.name]),
  );

  return rows.map((row) => {
    const payload = (row.after ?? {}) as {
      trigger?: string;
      subject?: Record<string, string | null>;
      actions?: { type: string; changed: boolean; detail: string }[];
    };

    return {
      id: row.id,
      automationId: row.entityId,
      // A deleted rule keeps its history; the audit row outlives it.
      name: names.get(row.entityId) ?? "(deleted rule)",
      trigger: payload.trigger ?? null,
      subject: payload.subject ?? {},
      actions: payload.actions ?? [],
      at: row.createdAt,
    };
  });
}
