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

/** Blank means "not set", so an emptied field clears rather than storing "". */
const optionalNote = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

/**
 * A focal point coordinate, as a whole percentage.
 *
 * Blank clears it back to centre, which is what an image with no focal point
 * has always done. Coerced because it arrives from a range input as a string.
 */
const focalCoordinate = z
  .union([z.literal(""), z.coerce.number().int().min(0).max(100)])
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

export const mediaUpdateSchema = z.object({
  id: z.string().min(1).max(40),
  filename: z.string().trim().min(1, "The file needs a name.").max(255),
  alt: optionalNote(300),
  /** A human title, distinct from the filename. */
  title: optionalNote(200),
  /** Default caption, used by blocks that show one and have none of their own. */
  caption: optionalNote(300),
  /** Internal notes — provenance, licence, who is in the shot. Never public. */
  description: optionalNote(2000),
  focalX: focalCoordinate,
  focalY: focalCoordinate,
  folderId: z.string().trim().max(40).nullable().optional(),
  /**
   * Tag names, not ids. An editor types words; matching them to rows — and
   * creating the ones that do not exist yet — is the service's job, exactly as
   * the CRM already does it.
   */
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(20, "Twenty tags is plenty.")
    .optional()
    .default([]),
});

export type MediaUpdateInput = z.infer<typeof mediaUpdateSchema>;

export const mediaListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(6).max(96).default(24),
  search: z.string().trim().max(200).optional(),
  type: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]).optional(),
  folderId: z.string().trim().max(40).optional(),
  /** Slug of a tag to filter by. */
  tag: z.string().trim().max(60).optional(),
  /**
   * Show only files nothing references.
   *
   * A separate flag rather than a sort, because answering it means reading all
   * the page content — see `referencedMediaIds`. It is opt-in so an ordinary
   * library page never pays for it.
   */
  unused: z
    .union([z.literal("1"), z.literal("true"), z.literal("")])
    .optional()
    .transform((value) => value === "1" || value === "true"),
});

export type MediaListParamsInput = z.infer<typeof mediaListParamsSchema>;
