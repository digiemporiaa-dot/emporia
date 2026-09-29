"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/actor";
import { generateReport, setReportNotes, setReportPublished } from "@/lib/services/social-report.service";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

/** Report writes. Validation here; permission, scope and state in the service. */

const actionLog = log("social");
const id = z.string().min(1).max(40);

function refresh(clientId: string, reportId?: string) {
  revalidatePath(`/admin/clients/${clientId}/social/reports`);
  if (reportId) revalidatePath(`/admin/clients/${clientId}/social/reports/${reportId}`);
  revalidatePath("/portal/social/reports");
}

export async function generateReportAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = z.object({ clientId: id, month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month.") }).safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Choose a month." };
    const report = await generateReport(actor, parsed.data);
    refresh(parsed.data.clientId, report.id);
    return { ok: true, data: { id: report.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "generating a social report was refused");
    return toActionFailure(error);
  }
}

export async function saveReportNotesAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = z.object({ clientId: id, reportId: id, notes: z.string().max(5_000).nullable() }).safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Those notes could not be read." };
    await setReportNotes(actor, parsed.data.reportId, parsed.data.notes);
    refresh(parsed.data.clientId, parsed.data.reportId);
    return { ok: true, data: { id: parsed.data.reportId } };
  } catch (error) {
    actionLog.warn({ err: error }, "saving report notes was refused");
    return toActionFailure(error);
  }
}

export async function setReportPublishedAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const parsed = z.object({ clientId: id, reportId: id, published: z.boolean() }).safeParse(input);
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "That report could not be identified." };
    await setReportPublished(actor, parsed.data.reportId, parsed.data.published);
    refresh(parsed.data.clientId, parsed.data.reportId);
    return { ok: true, data: { id: parsed.data.reportId } };
  } catch (error) {
    actionLog.warn({ err: error }, "publishing a social report was refused");
    return toActionFailure(error);
  }
}
