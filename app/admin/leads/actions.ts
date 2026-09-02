"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import * as crm from "@/lib/services/crm.service";
import {
  assignSchema,
  changeStatusSchema,
  noteSchema,
  prioritySetSchema,
  taskSchema,
} from "@/lib/validation/crm";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * CRM server actions.
 *
 * Authenticate, validate, delegate. The permission check and the row-level
 * visibility check both live in the service, so an action cannot skip them.
 */

const actionLog = log("crm");

export type CrmActionState = ActionResult<{ ok: true }> | null;

function refresh(leadId: string) {
  revalidatePath("/admin/leads");
  revalidatePath("/admin/leads/pipeline");
  revalidatePath(`/admin/leads/${leadId}`);
}

export async function changeStatusAction(
  _prev: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  try {
    const actor = await requireActor();
    const parsed = changeStatusSchema.safeParse({
      leadId: formData.get("leadId"),
      status: formData.get("status"),
      note: formData.get("note") || null,
    });

    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the form." };
    }

    await crm.changeStatus(actor, parsed.data.leadId, parsed.data.status, parsed.data.note ?? null);
    refresh(parsed.data.leadId);
    return { ok: true, data: { ok: true } };
  } catch (error) {
    actionLog.warn({ err: error }, "changeStatus refused or failed");
    return toActionFailure(error);
  }
}

/** Used by the board's drag-to-move, which has no form to submit. */
export async function moveLeadAction(leadId: string, status: string): Promise<ActionResult<{ ok: true }>> {
  try {
    const actor = await requireActor();
    const parsed = changeStatusSchema.safeParse({ leadId, status });
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That is not a pipeline stage." };
    }

    await crm.changeStatus(actor, parsed.data.leadId, parsed.data.status);
    refresh(parsed.data.leadId);
    return { ok: true, data: { ok: true } };
  } catch (error) {
    actionLog.warn({ err: error }, "moveLead refused or failed");
    return toActionFailure(error);
  }
}

export async function assignAction(
  _prev: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  try {
    const actor = await requireActor();
    const parsed = assignSchema.safeParse({
      leadId: formData.get("leadId"),
      toUserId: formData.get("toUserId") ?? "",
      reason: formData.get("reason") || null,
    });

    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the form." };
    }

    await crm.assignLead(
      actor,
      parsed.data.leadId,
      parsed.data.toUserId || null,
      parsed.data.reason ?? null,
    );
    refresh(parsed.data.leadId);
    return { ok: true, data: { ok: true } };
  } catch (error) {
    actionLog.warn({ err: error }, "assign refused or failed");
    return toActionFailure(error);
  }
}

export async function setPriorityAction(leadId: string, priority: string): Promise<void> {
  const actor = await requireActor();
  const parsed = prioritySetSchema.safeParse({ leadId, priority });
  if (!parsed.success) return;
  await crm.setPriority(actor, parsed.data.leadId, parsed.data.priority);
  refresh(parsed.data.leadId);
}

export async function addNoteAction(
  _prev: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  try {
    const actor = await requireActor();
    const parsed = noteSchema.safeParse({
      leadId: formData.get("leadId"),
      body: formData.get("body"),
    });

    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the form." };
    }

    await crm.addNote(actor, parsed.data.leadId, parsed.data.body);
    refresh(parsed.data.leadId);
    return { ok: true, data: { ok: true } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function addTaskAction(
  _prev: CrmActionState,
  formData: FormData,
): Promise<CrmActionState> {
  try {
    const actor = await requireActor();
    const parsed = taskSchema.safeParse({
      leadId: formData.get("leadId"),
      title: formData.get("title"),
      detail: formData.get("detail") || null,
      dueAt: formData.get("dueAt"),
      assigneeId: formData.get("assigneeId"),
      priority: formData.get("priority") || "MEDIUM",
    });

    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the form." };
    }

    await crm.addTask(actor, {
      leadId: parsed.data.leadId,
      title: parsed.data.title,
      detail: parsed.data.detail ?? null,
      dueAt: parsed.data.dueAt,
      assigneeId: parsed.data.assigneeId,
      priority: parsed.data.priority,
    });
    refresh(parsed.data.leadId);
    return { ok: true, data: { ok: true } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function completeTaskAction(taskId: string, leadId: string): Promise<void> {
  const actor = await requireActor();
  await crm.completeTask(actor, taskId);
  refresh(leadId);
}

export async function rescoreAction(leadId: string): Promise<void> {
  const actor = await requireActor();
  await crm.rescoreLead(actor, leadId);
  refresh(leadId);
}
