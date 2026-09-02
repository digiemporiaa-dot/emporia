import { z } from "zod";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES } from "@/lib/media/types";

/** Media input validation. */

const mimeSchema = z.enum(Object.keys(ALLOWED_TYPES) as [string, ...string[]], {
  message: "That file type is not supported.",
});

export const presignSchema = z.object({
  filename: z.string().trim().min(1, "The file needs a name.").max(255),
  /**
   * What the browser thinks the file is. Treated as a claim to be checked
   * against the stored bytes at confirm time, never as the truth.
   */
  contentType: mimeSchema,
  size: z.coerce
    .number()
    .int()
    .positive("That file is empty.")
    .max(MAX_UPLOAD_BYTES, "That file is too large."),
  folderId: z.string().trim().max(40).nullable().optional(),
  alt: z.string().trim().max(300).nullable().optional(),
  /** Set when replacing an existing item, which creates a new version. */
  replacesId: z.string().trim().max(40).nullable().optional(),
});

export type PresignInput = z.infer<typeof presignSchema>;

export const confirmSchema = z.object({
  /**
   * The signed upload intent the presign step issued — a base64url payload and
   * its HMAC, so it is a few hundred characters. Nothing else is accepted.
   */
  uploadId: z.string().trim().min(32).max(2048),
});

export const folderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name the folder.")
    .max(60)
    .regex(/^[\p{L}\p{N} ._-]+$/u, "Use letters, numbers, spaces, dots, dashes or underscores."),
  parentId: z.string().trim().max(40).nullable().optional(),
});

export type FolderInput = z.infer<typeof folderSchema>;

export const mediaUpdateSchema = z.object({
  id: z.string().min(1).max(40),
  filename: z.string().trim().min(1, "The file needs a name.").max(255),
  alt: z.string().trim().max(300).nullable().optional(),
  folderId: z.string().trim().max(40).nullable().optional(),
});

export type MediaUpdateInput = z.infer<typeof mediaUpdateSchema>;

export const mediaListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(6).max(96).default(24),
  search: z.string().trim().max(200).optional(),
  type: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]).optional(),
  folderId: z.string().trim().max(40).optional(),
});

export type MediaListParamsInput = z.infer<typeof mediaListParamsSchema>;
