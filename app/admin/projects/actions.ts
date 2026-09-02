"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import * as projects from "@/lib/services/project.service";
import * as delivery from "@/lib/services/delivery-content.service";
import {
  approvalDecisionSchema,
  approvalSchema,
  approvalVersionSchema,
  commentSchema,
  contentItemSchema,
  contentStageSchema,
  dependencySchema,
  milestoneSchema,
  projectSchema,
  projectStatusSchema,
  taskSchema,
  taskStatusSchema,
  timeEntrySchema,
} from "@/lib/validation/project";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";
import type { ApprovalStatus, ContentStage } from "@/generated/prisma/enums";

const actionLog = log("delivery");

export type DeliveryActionState = ActionResult<{ id: string }> | null;

function refreshProject(projectId?: string) {
  revalidatePath("/admin/projects");
  if (projectId) {
    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/admin/projects/${projectId}/board`);
  }
}

/** A failed parse returns the field errors so the form can mark the field. */
function invalid(error: { issues: { message: string }[]; flatten: () => { fieldErrors: unknown } }) {
  return {
    ok: false as const,
    code: "VALIDATION" as const,
    message: error.issues[0]?.message ?? "Check the form.",
    details: error.flatten().fieldErrors as Record<string, string[]>,
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function saveProjectAction(
  _prev: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = projectSchema.safeParse({
      ...raw,
      serviceId: raw["serviceId"] || null,
      contractId: raw["contractId"] || null,
      dueAt: raw["dueAt"] === "" ? null : raw["dueAt"],
    });

    if (!parsed.success) return invalid(parsed.error);

    const id = typeof raw["id"] === "string" && raw["id"] ? raw["id"] : null;
    const project = id
      ? await projects.updateProject(actor, id, parsed.data)
      : await projects.createProject(actor, parsed.data);

    refreshProject(project.id);
    return { ok: true, data: { id: project.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "saveProject refused or failed");
    return toActionFailure(error);
  }
}

export async function setProjectStatusAction(
  id: string,
  status: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = projectStatusSchema.safeParse({ projectId: id, status });
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That is not a project status." };
    }

    await projects.setProjectStatus(actor, parsed.data.projectId, parsed.data.status);
    refreshProject(id);
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Milestones and tasks
// ---------------------------------------------------------------------------

export async function saveMilestoneAction(
  _prev: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = milestoneSchema.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error);

    const id = typeof raw["id"] === "string" && raw["id"] ? raw["id"] : null;
    const milestone = await projects.saveMilestone(actor, id, parsed.data);

    refreshProject(parsed.data.projectId);
    return { ok: true, data: { id: milestone.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function saveTaskAction(
  _prev: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = taskSchema.safeParse({
      ...raw,
      parentId: raw["parentId"] || null,
      milestoneId: raw["milestoneId"] || null,
      assigneeId: raw["assigneeId"] || null,
      description: raw["description"] || null,
      dueAt: raw["dueAt"] === "" ? null : raw["dueAt"],
      estimateHours: raw["estimateHours"] || null,
    });

    if (!parsed.success) return invalid(parsed.error);

    const id = typeof raw["id"] === "string" && raw["id"] ? raw["id"] : null;
    const task = await projects.saveTask(actor, id, parsed.data);

    refreshProject(parsed.data.projectId);
    return { ok: true, data: { id: task.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "saveTask refused or failed");
    return toActionFailure(error);
  }
}

export async function moveTaskAction(
  taskId: string,
  status: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = taskStatusSchema.safeParse({ taskId, status });
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That is not a task status." };
    }

    await projects.setTaskStatus(actor, parsed.data.taskId, parsed.data.status);
    refreshProject();
    return { ok: true, data: { id: taskId } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function addDependencyAction(
  taskId: string,
  dependsOnId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = dependencySchema.safeParse({ taskId, dependsOnId });
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "Choose a task to depend on." };
    }

    await projects.addDependency(actor, parsed.data.taskId, parsed.data.dependsOnId);
    refreshProject();
    return { ok: true, data: { id: taskId } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function removeDependencyAction(
  taskId: string,
  dependsOnId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await projects.removeDependency(actor, taskId, dependsOnId);
    refreshProject();
    return { ok: true, data: { id: taskId } };
  } catch (error) {
    return toActionFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Comments and time
// ---------------------------------------------------------------------------

export async function addCommentAction(
  _prev: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  try {
    const actor = await requireActor();
    const parsed = commentSchema.safeParse({
      projectId: formData.get("projectId"),
      taskId: formData.get("taskId") || null,
      body: formData.get("body"),
    });

    if (!parsed.success) return invalid(parsed.error);

    const comment = await projects.addComment(actor, parsed.data);
    refreshProject(parsed.data.projectId);
    return { ok: true, data: { id: comment.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function logTimeAction(
  _prev: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = timeEntrySchema.safeParse({
      ...raw,
      taskId: raw["taskId"] || null,
      note: raw["note"] || null,
    });

    if (!parsed.success) return invalid(parsed.error);

    const entry = await projects.logTime(actor, parsed.data);
    refreshProject(parsed.data.projectId);
    return { ok: true, data: { id: entry.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function refreshContent(itemId?: string) {
  revalidatePath("/admin/content");
  if (itemId) revalidatePath(`/admin/content/${itemId}`);
}

export async function saveContentItemAction(
  _prev: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = contentItemSchema.safeParse({
      ...raw,
      brief: raw["brief"] || null,
      ownerId: raw["ownerId"] || null,
      scheduledFor: raw["scheduledFor"] === "" ? null : raw["scheduledFor"],
      mediaId: raw["mediaId"] || null,
    });

    if (!parsed.success) return invalid(parsed.error);

    const id = typeof raw["id"] === "string" && raw["id"] ? raw["id"] : null;
    const item = await delivery.saveContentItem(actor, id, parsed.data);

    refreshContent(item.id);
    return { ok: true, data: { id: item.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "saveContentItem refused or failed");
    return toActionFailure(error);
  }
}

export async function setContentStageAction(
  itemId: string,
  stage: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = contentStageSchema.safeParse({ itemId, stage });
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That is not a workflow stage." };
    }

    await delivery.setContentStage(actor, parsed.data.itemId, parsed.data.stage as ContentStage);
    refreshContent(itemId);
    return { ok: true, data: { id: itemId } };
  } catch (error) {
    return toActionFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export async function requestApprovalAction(
  _prev: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = approvalSchema.safeParse({
      ...raw,
      projectId: raw["projectId"] || null,
      contentItemId: raw["contentItemId"] || null,
      notes: raw["notes"] || null,
      mediaId: raw["mediaId"] || null,
    });

    if (!parsed.success) return invalid(parsed.error);

    const approval = await delivery.requestApproval(actor, parsed.data);

    revalidatePath("/admin/approvals");
    refreshContent(parsed.data.contentItemId ?? undefined);
    return { ok: true, data: { id: approval.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function addApprovalVersionAction(
  _prev: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  try {
    const actor = await requireActor();
    const parsed = approvalVersionSchema.safeParse({
      approvalId: formData.get("approvalId"),
      notes: formData.get("notes") || null,
      mediaId: formData.get("mediaId") || null,
    });

    if (!parsed.success) return invalid(parsed.error);

    const approval = await delivery.addApprovalVersion(
      actor,
      parsed.data.approvalId,
      parsed.data.notes ?? null,
      parsed.data.mediaId ?? null,
    );

    revalidatePath("/admin/approvals");
    revalidatePath(`/admin/approvals/${parsed.data.approvalId}`);
    return { ok: true, data: { id: approval.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function decideApprovalAction(
  _prev: DeliveryActionState,
  formData: FormData,
): Promise<DeliveryActionState> {
  try {
    const actor = await requireActor();
    const parsed = approvalDecisionSchema.safeParse({
      approvalId: formData.get("approvalId"),
      decision: formData.get("decision"),
      feedback: formData.get("feedback") || null,
    });

    if (!parsed.success) return invalid(parsed.error);

    await delivery.decideApproval(
      actor,
      parsed.data.approvalId,
      parsed.data.decision as Exclude<ApprovalStatus, "PENDING">,
      parsed.data.feedback ?? null,
    );

    revalidatePath("/admin/approvals");
    revalidatePath(`/admin/approvals/${parsed.data.approvalId}`);
    return { ok: true, data: { id: parsed.data.approvalId } };
  } catch (error) {
    return toActionFailure(error);
  }
}
