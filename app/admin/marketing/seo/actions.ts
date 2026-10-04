"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";
import { saveGoogleSettings } from "@/lib/services/seo-intel/google-settings.service";
import { chooseGscSite, disconnectGsc, connectGscWithServiceAccount } from "@/lib/services/seo-intel/gsc-connection.service";
import { syncGscNow } from "@/lib/services/seo-intel/gsc-sync.service";
import {
  crawlCancelSchema,
  crawlStartSchema,
  gscSiteChoiceSchema,
  keywordAddSchema,
  keywordRemoveSchema,
  keywordTagsSchema,
  seoGoogleSettingsSchema,
  urlInspectSchema,
} from "@/lib/validation/seo-intel";
import { addKeywords, removeKeywords, setKeywordTags } from "@/lib/services/seo-intel/keyword.service";
import { cancelCrawl, startCrawl } from "@/lib/services/seo-intel/crawl.service";
import { inspectUrlNow } from "@/lib/services/seo-intel/indexation.service";

/** Server actions for SEO Intelligence connections. Each re-checks permission in its service. */

const actionLog = log("seo-intel");

export type SeoActionState = ActionResult<{ message: string }> | null;

function refresh(propertyId?: string) {
  revalidatePath("/admin/marketing/seo");
  revalidatePath("/admin/marketing/seo/properties");
  if (propertyId) revalidatePath(`/admin/marketing/seo/properties/${propertyId}/search-console`);
}

const idOf = (formData: FormData) => {
  const value = formData.get("propertyId");
  return typeof value === "string" ? value : "";
};

export async function saveGoogleSettingsAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const raw = Object.fromEntries(formData.entries());
    const parsed = seoGoogleSettingsSchema.safeParse({
      ...raw,
      removeOAuth: raw["removeOAuth"] === "on",
      removeServiceAccount: raw["removeServiceAccount"] === "on",
    });
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the form.", details: parsed.error.flatten().fieldErrors };
    }
    await saveGoogleSettings(actor, parsed.data);
    revalidatePath("/admin/marketing/seo/settings");
    return { ok: true, data: { message: "Google settings saved." } };
  } catch (error) {
    actionLog.warn({ err: error }, "saveGoogleSettings refused");
    return toActionFailure(error);
  }
}

export async function serviceAccountAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const propertyId = idOf(formData);
    await connectGscWithServiceAccount(actor, propertyId);
    refresh(propertyId);
    return { ok: true, data: { message: "Now choose the Search Console property." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function chooseSiteAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = gscSiteChoiceSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Choose a Search Console property." };
    await chooseGscSite(actor, parsed.data.propertyId, parsed.data.siteUrl);
    refresh(parsed.data.propertyId);
    return { ok: true, data: { message: "Search Console connected. The first sync runs on the next schedule, or press Sync now." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function disconnectGscAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const propertyId = idOf(formData);
    await disconnectGsc(actor, propertyId);
    refresh(propertyId);
    return { ok: true, data: { message: "Search Console disconnected. Data already collected is kept." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function syncNowAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const propertyId = idOf(formData);
    const outcome = await syncGscNow(actor, propertyId);
    refresh(propertyId);
    if (outcome.status === "skipped") return { ok: false, code: "VALIDATION", message: outcome.reason };
    if (outcome.status === "FAILED") return { ok: false, code: "INTERNAL", message: outcome.error ?? "The sync failed." };
    return {
      ok: true,
      data: {
        message:
          outcome.status === "PARTIAL"
            ? `Synced ${outcome.daysWritten} days, then stopped: ${outcome.error}`
            : `Synced ${outcome.daysWritten} days of Search Console data.`,
      },
    };
  } catch (error) {
    return toActionFailure(error);
  }
}

function refreshCrawl(propertyId: string) {
  revalidatePath("/admin/marketing/seo/crawl");
  revalidatePath("/admin/marketing/seo/technical");
  revalidatePath("/admin/marketing/seo/indexation");
  revalidatePath(`/admin/marketing/seo/properties/${propertyId}`);
}

export async function startCrawlAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = crawlStartSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Choose a website to crawl." };
    const run = await startCrawl(actor, parsed.data.propertyId);
    refreshCrawl(parsed.data.propertyId);
    return { ok: true, data: { message: `Crawl started. Up to ${run.maxPages} pages are fetched a batch at a time; this page updates as it goes.` } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function cancelCrawlAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = crawlCancelSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "That crawl was not found." };
    await cancelCrawl(actor, parsed.data.runId);
    refreshCrawl(parsed.data.propertyId);
    return { ok: true, data: { message: "Crawl cancelled." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function inspectUrlAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = urlInspectSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the address." };
    const result = await inspectUrlNow(actor, parsed.data.propertyId, parsed.data.url);
    refreshCrawl(parsed.data.propertyId);
    return { ok: true, data: { message: result?.coverageState ? `Google: ${result.coverageState}.` : "Google did not return a status; see the row for the reason." } };
  } catch (error) {
    return toActionFailure(error);
  }
}

function refreshKeywords() {
  revalidatePath("/admin/marketing/seo/keywords", "layout");
  revalidatePath("/admin/marketing/seo/opportunities");
}

/** Track keywords: a pasted list in `keywords`, or the ticked `pick` boxes from a suggestions table. */
export async function addKeywordsAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const picked = formData.getAll("pick").filter((value): value is string => typeof value === "string");
    const typed = formData.get("keywords");
    const parsed = keywordAddSchema.safeParse({
      propertyId: formData.get("propertyId"),
      keywords: typeof typed === "string" && typed.trim() ? typed : picked.join("\n"),
      tags: formData.get("tags") ?? "",
      source: formData.get("source") ?? "MANUAL",
    });
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Check the keywords." };
    const result = await addKeywords(actor, parsed.data.propertyId, parsed.data);
    refreshKeywords();
    const parts = [`Tracking ${result.added} new keyword${result.added === 1 ? "" : "s"}.`];
    if (result.alreadyTracked) parts.push(`${result.alreadyTracked} already tracked.`);
    if (result.rejected.length) parts.push(`${result.rejected.length} skipped: over 200 characters.`);
    return { ok: true, data: { message: parts.join(" ") } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function removeKeywordsAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = keywordRemoveSchema.safeParse({ propertyId: formData.get("propertyId"), keywordIds: formData.getAll("keywordIds") });
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: parsed.error.issues[0]?.message ?? "Choose keywords to untrack." };
    const removed = await removeKeywords(actor, parsed.data.propertyId, parsed.data.keywordIds);
    refreshKeywords();
    return { ok: true, data: { message: `Stopped tracking ${removed} keyword${removed === 1 ? "" : "s"}. Search Console history is kept.` } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function setKeywordTagsAction(_prev: SeoActionState, formData: FormData): Promise<SeoActionState> {
  try {
    const actor = await requireActor();
    const parsed = keywordTagsSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { ok: false, code: "VALIDATION", message: "Check the tags." };
    const tags = await setKeywordTags(actor, parsed.data.propertyId, parsed.data.keywordId, parsed.data.tags);
    refreshKeywords();
    return { ok: true, data: { message: tags.length ? `Tags: ${tags.join(", ")}.` : "Tags cleared." } };
  } catch (error) {
    return toActionFailure(error);
  }
}
