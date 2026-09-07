"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import {
  pageDraftSchema,
  pageSchema,
  publishStatusSchema,
  sectionOrderSchema,
} from "@/lib/validation/page";
import * as pageService from "@/lib/services/page.service";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Website page CMS server actions.
 *
 * Each one: authenticate, validate with zod, then hand off to the service,
 * which performs the permission check and writes the audit row. No business
 * logic lives here (CLAUDE.md 4).
 *
 * The admin UI that calls these arrives with the Pages module; the actions are
 * the entry points it will bind to. They are safe to ship ahead of it — every
 * one is authenticated and permission-checked server-side, so an action with no
 * button in front of it is not an unguarded endpoint.
 */

const actionLog = log("pages");

const LIST_PATH = "/admin/website/pages";

function fields(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(formData.entries());
}

export type PageActionState = ActionResult<{ id: string; slug: string }> | null;

export async function createPageAction(
  _prev: PageActionState,
  formData: FormData,
): Promise<PageActionState> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);

    const parsed = pageDraftSchema.safeParse({
      title: raw["title"],
      ...(typeof raw["slug"] === "string" && raw["slug"] ? { slug: raw["slug"] } : {}),
    });
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const page = await pageService.createPage(actor, parsed.data);

    revalidatePath(LIST_PATH);
    return { ok: true, data: { id: page.id, slug: page.slug } };
  } catch (error) {
    actionLog.error({ err: error }, "create page failed");
    return toActionFailure(error);
  }
}

export async function savePageAction(
  _prev: PageActionState,
  formData: FormData,
): Promise<PageActionState> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);

    const id = typeof raw["id"] === "string" ? raw["id"] : "";
    if (!id) {
      return { ok: false, code: "VALIDATION", message: "Missing page id." };
    }

    const parsed = pageSchema.safeParse({
      ...raw,
      internalName: raw["internalName"] === "" ? null : raw["internalName"],
      description: raw["description"] === "" ? null : raw["description"],
    });
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const page = await pageService.updatePage(actor, id, parsed.data);

    revalidatePath(LIST_PATH);
    revalidatePath(`${LIST_PATH}/${id}`);
    return { ok: true, data: { id: page.id, slug: page.slug } };
  } catch (error) {
    actionLog.error({ err: error }, "save page failed");
    return toActionFailure(error);
  }
}

export async function setPageStatusAction(
  id: string,
  status: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();

    const parsed = publishStatusSchema.safeParse(status);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "Unknown page status." };
    }

    const page = await pageService.setPageStatus(actor, id, parsed.data);

    revalidatePath(LIST_PATH);
    return { ok: true, data: { id: page.id } };
  } catch (error) {
    actionLog.error({ err: error }, "set page status failed");
    return toActionFailure(error);
  }
}

export async function duplicatePageAction(
  id: string,
): Promise<ActionResult<{ id: string; slug: string }>> {
  try {
    const actor = await requireActor();
    const copy = await pageService.duplicatePage(actor, id);

    revalidatePath(LIST_PATH);
    return { ok: true, data: { id: copy.id, slug: copy.slug } };
  } catch (error) {
    actionLog.error({ err: error }, "duplicate page failed");
    return toActionFailure(error);
  }
}

export async function deletePageAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await pageService.deletePage(actor, id);

    revalidatePath(LIST_PATH);
    return { ok: true, data: { id } };
  } catch (error) {
    actionLog.error({ err: error }, "delete page failed");
    return toActionFailure(error);
  }
}

export async function restorePageAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await pageService.restorePage(actor, id);

    revalidatePath(LIST_PATH);
    return { ok: true, data: { id } };
  } catch (error) {
    actionLog.error({ err: error }, "restore page failed");
    return toActionFailure(error);
  }
}

export async function reorderSectionsAction(
  pageId: string,
  ordered: unknown,
): Promise<ActionResult<{ pageId: string }>> {
  try {
    const actor = await requireActor();

    const parsed = sectionOrderSchema.safeParse(ordered);
    if (!parsed.success) {
      return { ok: false, code: "VALIDATION", message: "That section order is not valid." };
    }

    await pageService.reorderSections(actor, pageId, parsed.data);

    revalidatePath(`${LIST_PATH}/${pageId}`);
    return { ok: true, data: { pageId } };
  } catch (error) {
    actionLog.error({ err: error }, "reorder sections failed");
    return toActionFailure(error);
  }
}

/** Live slug suggestion for the slug editor. */
export async function suggestSlugAction(title: string): Promise<ActionResult<{ slug: string }>> {
  try {
    const actor = await requireActor();
    const slug = await pageService.suggestSlug(actor, title);
    return { ok: true, data: { slug } };
  } catch (error) {
    return toActionFailure(error);
  }
}
