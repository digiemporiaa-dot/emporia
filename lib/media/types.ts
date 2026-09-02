import type { MediaType } from "@/generated/prisma/enums";

/**
 * What may be uploaded, and how it is recognised.
 *
 * The extension a browser sends is a hint, nothing more. Every upload is
 * confirmed by sniffing the leading bytes of the stored object, and a file
 * whose bytes disagree with its claimed type is rejected (CLAUDE.md 11).
 */

export type AllowedType = {
  /** The canonical MIME type stored on the Media row. */
  mime: string;
  /** The one extension used for the stored object key. */
  extension: string;
  kind: MediaType;
  /** Bytes cap for this type. */
  maxBytes: number;
  /**
   * Magic-byte signatures. `offset` is where the bytes must appear. An empty
   * list means the format has no usable signature and is checked another way.
   */
  signatures: { offset: number; bytes: number[] }[];
};

const MB = 1024 * 1024;

const utf8 = (text: string) => [...text].map((c) => c.charCodeAt(0));

/**
 * The supported set, from docs/BUILD-PLAN.md phase 11: JPG, JPEG, PNG, WEBP,
 * SVG, GIF, MP4, PDF, DOCX, XLSX.
 */
export const ALLOWED_TYPES: Record<string, AllowedType> = {
  "image/jpeg": {
    mime: "image/jpeg",
    extension: "jpg",
    kind: "IMAGE",
    maxBytes: 10 * MB,
    signatures: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  },
  "image/png": {
    mime: "image/png",
    extension: "png",
    kind: "IMAGE",
    maxBytes: 10 * MB,
    signatures: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  },
  "image/webp": {
    mime: "image/webp",
    extension: "webp",
    kind: "IMAGE",
    maxBytes: 10 * MB,
    // "RIFF" then four size bytes then "WEBP".
    signatures: [
      { offset: 0, bytes: utf8("RIFF") },
      { offset: 8, bytes: utf8("WEBP") },
    ],
  },
  "image/gif": {
    mime: "image/gif",
    extension: "gif",
    kind: "IMAGE",
    maxBytes: 10 * MB,
    signatures: [{ offset: 0, bytes: utf8("GIF8") }],
  },
  "image/svg+xml": {
    mime: "image/svg+xml",
    extension: "svg",
    kind: "IMAGE",
    maxBytes: 2 * MB,
    // SVG is XML: there is no magic number, so it is validated by parsing
    // rather than by signature. See looksLikeSvg().
    signatures: [],
  },
  "video/mp4": {
    mime: "video/mp4",
    extension: "mp4",
    kind: "VIDEO",
    maxBytes: 200 * MB,
    // ISO base media: "ftyp" at offset 4.
    signatures: [{ offset: 4, bytes: utf8("ftyp") }],
  },
  "application/pdf": {
    mime: "application/pdf",
    extension: "pdf",
    kind: "DOCUMENT",
    maxBytes: 25 * MB,
    signatures: [{ offset: 0, bytes: utf8("%PDF-") }],
  },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
    kind: "DOCUMENT",
    maxBytes: 25 * MB,
    // OOXML is a zip archive.
    signatures: [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    extension: "xlsx",
    kind: "DOCUMENT",
    maxBytes: 25 * MB,
    signatures: [{ offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }],
  },
};

/** Extensions the UI accepts, purely as a hint to the file picker. */
export const ACCEPT_ATTRIBUTE = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".svg",
  ".gif",
  ".mp4",
  ".pdf",
  ".docx",
  ".xlsx",
].join(",");

/** Largest upload of any type, used for the first cheap rejection. */
export const MAX_UPLOAD_BYTES = Math.max(
  ...Object.values(ALLOWED_TYPES).map((type) => type.maxBytes),
);

export function allowedTypeFor(mime: string): AllowedType | null {
  return ALLOWED_TYPES[mime.toLowerCase().trim()] ?? null;
}

/**
 * The extension a claimed MIME type maps to.
 *
 * Note the direction: extension is derived *from* the verified type, never the
 * other way round. `invoice.pdf.exe` cannot produce an `.exe` object key.
 */
export function extensionFor(mime: string): string | null {
  return allowedTypeFor(mime)?.extension ?? null;
}
