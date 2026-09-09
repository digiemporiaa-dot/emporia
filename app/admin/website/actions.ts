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
import { pageSeoSchema } from "@/lib/validation/seo";
import * as reusableService from "@/lib/services/reusable-section.service";
import * as versionService from "@/lib/services/page-version.service";
import {
  reusableSectionDraftSchema,
  versionReasonSchema,
  workflowNoteSchema,
} from "@/lib/validation/page";
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

// ---------------------------------------------------------------------------
// Sections — the page builder
// ---------------------------------------------------------------------------

const BUILDER_PATH = (pageId: string) => `${LIST_PATH}/${pageId}`;

export async function addSectionAction(
  pageId: string,
  type: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const section = await pageService.addSection(actor, pageId, type);

    revalidatePath(BUILDER_PATH(pageId));
    return { ok: true, data: { id: section.id } };
  } catch (error) {
    actionLog.error({ err: error }, "add section failed");
    return toActionFailure(error);
  }
}

/**
 * Save one section's content.
 *
 * `content` arrives as an object from the editor and is validated in the
 * service against that block's own schema — the stored value is the parsed
 * one, never the payload as sent.
 */
export async function saveSectionAction(
  pageId: string,
  sectionId: string,
  content: unknown,
  name?: string | null,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const section = await pageService.updateSection(actor, sectionId, {
      content,
      ...(name === undefined ? {} : { name }),
    });

    revalidatePath(BUILDER_PATH(pageId));
    return { ok: true, data: { id: section.id } };
  } catch (error) {
    actionLog.error({ err: error }, "save section failed");
    return toActionFailure(error);
  }
}

export async function changeSectionTypeAction(
  pageId: string,
  sectionId: string,
  type: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const section = await pageService.changeSectionType(actor, sectionId, type);

    revalidatePath(BUILDER_PATH(pageId));
    return { ok: true, data: { id: section.id } };
  } catch (error) {
    actionLog.error({ err: error }, "changeSectionType failed");
    return toActionFailure(error);
  }
}

export async function duplicateSectionAction(
  pageId: string,
  sectionId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const copy = await pageService.duplicateSection(actor, sectionId);

    revalidatePath(BUILDER_PATH(pageId));
    return { ok: true, data: { id: copy.id } };
  } catch (error) {
    actionLog.error({ err: error }, "duplicate section failed");
    return toActionFailure(error);
  }
}

export async function setSectionVisibleAction(
  pageId: string,
  sectionId: string,
  isVisible: boolean,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const section = await pageService.setSectionVisible(actor, sectionId, isVisible);

    revalidatePath(BUILDER_PATH(pageId));
    return { ok: true, data: { id: section.id } };
  } catch (error) {
    actionLog.error({ err: error }, "set section visibility failed");
    return toActionFailure(error);
  }
}

export async function deleteSectionAction(
  pageId: string,
  sectionId: string,
): Promise<ActionResult<{ pageId: string }>> {
  try {
    const actor = await requireActor();
    const result = await pageService.deleteSection(actor, sectionId);

    revalidatePath(BUILDER_PATH(pageId));
    return { ok: true, data: result };
  } catch (error) {
    actionLog.error({ err: error }, "delete section failed");
    return toActionFailure(error);
  }
}

// ---------------------------------------------------------------------------
// SEO and preview links
// ---------------------------------------------------------------------------

export async function savePageSeoAction(
  _prev: ActionResult<{ id: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }> | null> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);

    const pageId = typeof raw["pageId"] === "string" ? raw["pageId"] : "";
    if (!pageId) return { ok: false, code: "VALIDATION", message: "Missing page id." };

    const parsed = pageSeoSchema.safeParse({
      ...raw,
      // Unchecked boxes are absent from FormData entirely, which is not the
      // same as false unless it is made so here.
      robotsIndex: raw["robotsIndex"] === "on",
      robotsFollow: raw["robotsFollow"] === "on",
    });
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the SEO fields.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    await pageService.updatePageSeo(actor, pageId, parsed.data);

    revalidatePath(BUILDER_PATH(pageId));
    return { ok: true, data: { id: pageId } };
  } catch (error) {
    actionLog.error({ err: error }, "save page seo failed");
    return toActionFailure(error);
  }
}

export async function issuePreviewTokenAction(
  pageId: string,
): Promise<ActionResult<{ token: string }>> {
  try {
    const actor = await requireActor();
    const token = await pageService.issuePreviewToken(actor, pageId);

    revalidatePath(BUILDER_PATH(pageId));
    return { ok: true, data: { token } };
  } catch (error) {
    actionLog.error({ err: error }, "issue preview token failed");
    return toActionFailure(error);
  }
}

export async function revokePreviewTokenAction(
  pageId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await pageService.revokePreviewToken(actor, pageId);

    revalidatePath(BUILDER_PATH(pageId));
    return { ok: true, data: { id: pageId } };
  } catch (error) {
    actionLog.error({ err: error }, "revoke preview token failed");
    return toActionFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Reusable sections
// ---------------------------------------------------------------------------

const REUSABLE_PATH = "/admin/website/sections";

export type ReusableActionState = ActionResult<{ id: string }> | null;

export async function createReusableSectionAction(
  _prev: ReusableActionState,
  formData: FormData,
): Promise<ReusableActionState> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);

    const parsed = reusableSectionDraftSchema.safeParse({
      name: raw["name"],
      type: raw["type"],
      isGlobal: raw["isGlobal"] === "on",
    });
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const section = await reusableService.createReusableSection(actor, parsed.data);

    revalidatePath(REUSABLE_PATH);
    return { ok: true, data: { id: section.id } };
  } catch (error) {
    actionLog.error({ err: error }, "create reusable section failed");
    return toActionFailure(error);
  }
}

export async function saveReusableSectionAction(
  id: string,
  input: { name: string; status: string; isGlobal: boolean; content: unknown },
): Promise<ActionResult<{ id: string; placements: number }>> {
  try {
    const actor = await requireActor();

    const status = publishStatusSchema.safeParse(input.status);
    if (!status.success) {
      return { ok: false, code: "VALIDATION", message: "Unknown status." };
    }

    const section = await reusableService.updateReusableSection(actor, id, {
      name: input.name,
      status: status.data,
      isGlobal: input.isGlobal,
      content: input.content,
    });

    revalidatePath(REUSABLE_PATH);
    revalidatePath(`${REUSABLE_PATH}/${id}`);
    return { ok: true, data: { id: section.id, placements: section._count.usages } };
  } catch (error) {
    actionLog.error({ err: error }, "save reusable section failed");
    return toActionFailure(error);
  }
}

export async function deleteReusableSectionAction(
  id: string,
): Promise<ActionResult<{ detached: number }>> {
  try {
    const actor = await requireActor();
    const result = await reusableService.deleteReusableSection(actor, id);

    revalidatePath(REUSABLE_PATH);
    return { ok: true, data: result };
  } catch (error) {
    actionLog.error({ err: error }, "delete reusable section failed");
    return toActionFailure(error);
  }
}

export async function insertReusableSectionAction(
  pageId: string,
  reusableId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const section = await reusableService.insertReusableSection(actor, pageId, reusableId);

    revalidatePath(BUILDER_PATH(pageId));
    return { ok: true, data: { id: section.id } };
  } catch (error) {
    actionLog.error({ err: error }, "insert reusable section failed");
    return toActionFailure(error);
  }
}

export async function detachSectionAction(
  pageId: string,
  sectionId: string,
): Promise<ActionResult<{ pageId: string }>> {
  try {
    const actor = await requireActor();
    const result = await reusableService.detachSection(actor, sectionId);

    revalidatePath(BUILDER_PATH(pageId));
    return { ok: true, data: result };
  } catch (error) {
    actionLog.error({ err: error }, "detach section failed");
    return toActionFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Workflow and version history
// ---------------------------------------------------------------------------

export type WorkflowActionState = ActionResult<{ workflow: string }> | null;

export async function setWorkflowAction(
  pageId: string,
  workflow: "DRAFT" | "IN_REVIEW" | "CHANGES_REQUESTED" | "APPROVED",
  note?: string,
): Promise<WorkflowActionState> {
  try {
    const actor = await requireActor();
    const parsed = workflowNoteSchema.safeParse({ workflow, note: note ?? "" });
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the note.",
      };
    }

    const page = await pageService.setPageWorkflow(
      actor,
      pageId,
      parsed.data.workflow,
      parsed.data.note,
    );
    revalidatePath(`${LIST_PATH}/${pageId}`);
    return { ok: true, data: { workflow: page.workflow } };
  } catch (error) {
    actionLog.error({ err: error, pageId }, "setWorkflow failed");
    return toActionFailure(error);
  }
}

export async function saveVersionAction(
  pageId: string,
  reason: string,
): Promise<ActionResult<{ version: number }>> {
  try {
    const actor = await requireActor();
    const parsed = versionReasonSchema.safeParse({ reason });
    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the description.",
      };
    }

    const version = await versionService.saveVersion(actor, pageId, parsed.data.reason);
    revalidatePath(`${LIST_PATH}/${pageId}`);
    return { ok: true, data: { version: version.version } };
  } catch (error) {
    actionLog.error({ err: error, pageId }, "saveVersion failed");
    return toActionFailure(error);
  }
}

export async function restoreVersionAction(
  pageId: string,
  version: number,
): Promise<ActionResult<{ slugKept: boolean }>> {
  try {
    const actor = await requireActor();
    const restored = await versionService.restoreVersion(actor, pageId, version);
    revalidatePath(`${LIST_PATH}/${pageId}`);
    return { ok: true, data: { slugKept: restored.slugKept } };
  } catch (error) {
    actionLog.error({ err: error, pageId, version }, "restoreVersion failed");
    return toActionFailure(error);
  }
}

export async function deleteVersionAction(
  pageId: string,
  version: number,
): Promise<ActionResult<{ version: number }>> {
  try {
    const actor = await requireActor();
    await versionService.deleteVersion(actor, pageId, version);
    revalidatePath(`${LIST_PATH}/${pageId}`);
    return { ok: true, data: { version } };
  } catch (error) {
    actionLog.error({ err: error, pageId, version }, "deleteVersion failed");
    return toActionFailure(error);
  }
}

/** What changed between a stored version and what the page says now. */
export async function compareVersionAction(
  pageId: string,
  version: number,
): Promise<ActionResult<versionService.VersionDiff>> {
  try {
    const actor = await requireActor();
    const diff = await versionService.compareWithCurrent(actor, pageId, version);
    return { ok: true, data: diff };
  } catch (error) {
    actionLog.error({ err: error, pageId, version }, "compareVersion failed");
    return toActionFailure(error);
  }
}
