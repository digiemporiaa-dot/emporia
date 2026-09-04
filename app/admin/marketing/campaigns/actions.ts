"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import * as campaigns from "@/lib/services/campaign.service";
import {
  campaignMetricSchema,
  campaignSchema,
  metricImportSchema,
} from "@/lib/validation/marketing";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("marketing");

export type CampaignActionState = ActionResult<{ id: string }> | null;

function refresh(campaignId?: string) {
  revalidatePath("/admin/marketing");
  revalidatePath("/admin/marketing/campaigns");
  revalidatePath("/admin/analytics");
  revalidatePath("/portal/campaigns");
  if (campaignId) revalidatePath(`/admin/marketing/campaigns/${campaignId}`);
}

export async function saveCampaignAction(
  _prev: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = campaignSchema.safeParse({
      ...raw,
      clientId: raw["clientId"] || null,
      objective: raw["objective"] || null,
      endsAt: raw["endsAt"] === "" ? null : raw["endsAt"],
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const id = typeof raw["id"] === "string" && raw["id"] ? raw["id"] : null;
    const campaign = id
      ? await campaigns.updateCampaign(actor, id, parsed.data)
      : await campaigns.createCampaign(actor, parsed.data);

    refresh(campaign.id);
    return { ok: true, data: { id: campaign.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "saveCampaign refused");
    return toActionFailure(error);
  }
}

export async function deleteCampaignAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await campaigns.deleteCampaign(actor, id);
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function recordMetricAction(
  _prev: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());

    const parsed = campaignMetricSchema.safeParse({
      ...raw,
      // A blank revenue column stays null: nobody measured it, which is not
      // the same as measuring zero.
      revenue: raw["revenue"] ? raw["revenue"] : null,
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the row.",
      };
    }

    const metric = await campaigns.recordMetric(actor, parsed.data);
    refresh(parsed.data.campaignId);
    return { ok: true, data: { id: metric.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "recordMetric refused");
    return toActionFailure(error);
  }
}

export async function deleteMetricAction(
  id: string,
  campaignId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await campaigns.deleteMetric(actor, id);
    refresh(campaignId);
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function importMetricsAction(
  formData: FormData,
): Promise<ActionResult<campaigns.ImportOutcome>> {
  try {
    const actor = await requireActor();
    const parsed = metricImportSchema.safeParse({
      campaignId: formData.get("campaignId"),
      csv: formData.get("csv"),
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Paste some rows first.",
      };
    }

    const outcome = await campaigns.importMetrics(actor, parsed.data.campaignId, parsed.data.csv);
    refresh(parsed.data.campaignId);
    return { ok: true, data: outcome };
  } catch (error) {
    actionLog.warn({ err: error }, "importMetrics refused");
    return toActionFailure(error);
  }
}
