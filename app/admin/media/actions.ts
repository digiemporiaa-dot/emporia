"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import * as media from "@/lib/services/media.service";
import { folderSchema, mediaUpdateSchema } from "@/lib/validation/media";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

const actionLog = log("media");

export type MediaActionState = ActionResult<{ id: string }> | null;

function refresh() {
  revalidatePath("/admin/media");
}

export async function createFolderAction(
  _prev: MediaActionState,
  formData: FormData,
): Promise<MediaActionState> {
  try {
    const actor = await requireActor();
    const parsed = folderSchema.safeParse({
      name: formData.get("name"),
      parentId: formData.get("parentId") || null,
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
      };
    }

    const folder = await media.createFolder(actor, parsed.data);
    refresh();
    return { ok: true, data: { id: folder.id } };
  } catch (error) {
    actionLog.warn({ err: error }, "createFolder refused");
    return toActionFailure(error);
  }
}

export async function deleteFolderAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await media.deleteFolder(actor, id);
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function updateMediaAction(
  _prev: MediaActionState,
  formData: FormData,
): Promise<MediaActionState> {
  try {
    const actor = await requireActor();
    const parsed = mediaUpdateSchema.safeParse({
      id: formData.get("id"),
      filename: formData.get("filename"),
      alt: formData.get("alt") || null,
      folderId: formData.get("folderId") || null,
    });

    if (!parsed.success) {
      return {
        ok: false,
        code: "VALIDATION",
        message: parsed.error.issues[0]?.message ?? "Check the form.",
        details: parsed.error.flatten().fieldErrors,
      };
    }

    const updated = await media.updateMedia(actor, parsed.data);
    refresh();
    return { ok: true, data: { id: updated.id } };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteMediaAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await media.deleteMedia(actor, id);
    refresh();
    return { ok: true, data: { id } };
  } catch (error) {
    actionLog.warn({ err: error }, "deleteMedia refused");
    return toActionFailure(error);
  }
}
