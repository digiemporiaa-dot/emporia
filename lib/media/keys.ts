import { randomBytes } from "node:crypto";
import { extensionFor } from "@/lib/media/types";

/**
 * Object keys.
 *
 * A key is generated server-side from random bytes and the *verified* type's
 * extension. It never contains the uploader's filename: a filename can carry
 * path traversal, a second extension, a unicode trick, or simply someone's
 * private information in a URL that will be public (CLAUDE.md 11).
 *
 * The original filename is kept on the Media row for display, sanitised first.
 */
export function objectKey(mime: string, now = new Date()): string {
  const extension = extensionFor(mime);
  if (!extension) throw new Error(`No extension mapping for ${mime}`);

  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = randomBytes(16).toString("hex");

  // Date-partitioned so the bucket stays browsable, opaque so it leaks nothing.
  return `media/${year}/${month}/${id}.${extension}`;
}

/**
 * A display name for an uploaded file.
 *
 * Kept close to what the user chose, with anything that could be read as a
 * path, a control character or a second extension removed. The extension is
 * always the verified type's, never the one the user supplied.
 */
export function safeFilename(input: string, mime: string): string {
  const extension = extensionFor(mime) ?? "bin";

  const base = (input.replace(/\\/g, "/").split("/").pop() ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\.[^.]*$/, "")
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .replace(/\s+/g, " ")
    // Leading and trailing dots would produce a hidden file, or a name that is
    // nothing but dots.
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);

  return `${base || "file"}.${extension}`;
}
