import { z } from "zod";

/** Ids posted by the delete and recycle-bin buttons. */
const id = z.string().min(1).max(40);

export const deleteLeadsSchema = z.object({
  // The service caps a bulk delete too; this keeps an oversized post from
  // reaching it at all.
  ids: z.array(id).min(1, "Choose at least one lead.").max(200, "Delete at most 200 leads at a time."),
});

export const binItemSchema = z.object({ id });
