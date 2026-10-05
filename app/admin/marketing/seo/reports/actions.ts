"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { toActionFailure } from "@/lib/errors";
import { seoReportGenerateSchema, seoReportNotesSchema, seoReportPublishSchema } from "@/lib/validation/seo-intel";
import { generateSeoReport, setSeoReportNotes, setSeoReportPublished } from "@/lib/services/seo-intel/seo-report.service";
import { reportMonthLabel } from "@/lib/seo-intel/report-doc";
import type { SeoActionState } from "../actions";

/** Monthly SEO report writes (Phase 11). Validation here; permission, scope and state in the service. */

function refresh() {
  revalidatePath("/admin/marketing/seo/reports");
  revalidatePath("/portal/seo/reports");
}

export async function generateSeoReportAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = seoReportGenerateSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Choose a month." };
    await generateSeoReport(actor, parsed.data);
    refresh();
    return { ok: true, data: { message: `The ${reportMonthLabel(parsed.data.month)} report is ready as a draft.` } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function saveSeoReportNotesAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = seoReportNotesSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Those notes could not be read." };
    await setSeoReportNotes(actor, parsed.data.reportId, parsed.data.notes);
    refresh();
    return { ok: true, data: { message: "Notes saved." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function setSeoReportPublishedAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = seoReportPublishSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "That report could not be identified." };
    await setSeoReportPublished(actor, parsed.data.reportId, parsed.data.published);
    refresh();
    return { ok: true, data: { message: parsed.data.published ? "Published. The client's portal users have been emailed." : "Unpublished. The client no longer sees it." } };
  } catch (error) {
    return toActionFailure(error);
  }
}
