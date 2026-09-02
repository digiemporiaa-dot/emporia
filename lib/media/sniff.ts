import { ALLOWED_TYPES, allowedTypeFor, type AllowedType } from "@/lib/media/types";

/**
 * Content sniffing.
 *
 * Nothing here trusts a filename, an extension, or the `Content-Type` a client
 * sent. The bytes decide, and a file whose bytes do not match the type it was
 * presigned for is rejected (CLAUDE.md 11, and the phase 11 exit criterion).
 */

/** How many leading bytes are enough to identify every supported type. */
export const SNIFF_BYTES = 4096;

function matches(head: Uint8Array, signature: { offset: number; bytes: number[] }): boolean {
  if (head.length < signature.offset + signature.bytes.length) return false;
  return signature.bytes.every((byte, index) => head[signature.offset + index] === byte);
}

/**
 * SVG has no magic number, so it is recognised structurally: it must parse as
 * XML whose root element is <svg>. Leading whitespace, an XML declaration and a
 * doctype are allowed; anything else is not an SVG.
 */
export function looksLikeSvg(head: Uint8Array): boolean {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head);

  // Strip a BOM, whitespace, an XML prolog, comments and a doctype.
  const stripped = text
    .replace(/^﻿/, "")
    .replace(/^\s+/, "")
    .replace(/^<\?xml[^>]*\?>\s*/i, "")
    .replace(/^(?:<!--[\s\S]*?-->\s*)*/, "")
    .replace(/^<!DOCTYPE[^>]*>\s*/i, "")
    .replace(/^(?:<!--[\s\S]*?-->\s*)*/, "");

  return /^<svg[\s>]/i.test(stripped);
}

/**
 * Scripting inside an SVG.
 *
 * An SVG is a document the browser executes, so one served from our own origin
 * can run script against it. The safe answer for a marketing site's media
 * library is to refuse SVGs that carry script or external references rather
 * than to sanitise them and hope.
 */
export function svgIsDangerous(head: Uint8Array): boolean {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head).toLowerCase();

  return (
    text.includes("<script") ||
    text.includes("javascript:") ||
    /\son\w+\s*=/.test(text) ||
    text.includes("<foreignobject") ||
    text.includes("<iframe") ||
    text.includes("<use") ||
    text.includes("xlink:href=\"http") ||
    text.includes("href=\"http")
  );
}

export type SniffResult =
  | { ok: true; type: AllowedType }
  | { ok: false; reason: string };

/**
 * Decide what a file actually is, given the type it claims to be.
 *
 * The claim narrows what is acceptable; the bytes decide whether the claim
 * holds. A PNG renamed to .pdf and presigned as application/pdf fails here.
 */
export function sniff(head: Uint8Array, claimedMime: string): SniffResult {
  const claimed = allowedTypeFor(claimedMime);
  if (!claimed) return { ok: false, reason: "That file type is not supported." };

  if (claimed.mime === "image/svg+xml") {
    if (!looksLikeSvg(head)) {
      return { ok: false, reason: "That file is not an SVG." };
    }
    if (svgIsDangerous(head)) {
      return {
        ok: false,
        reason: "That SVG contains script or external references, which are not allowed.",
      };
    }
    return { ok: true, type: claimed };
  }

  if (claimed.signatures.every((signature) => matches(head, signature))) {
    return { ok: true, type: claimed };
  }

  // The bytes did not match the claim. Say what they actually look like when
  // that is knowable — it turns a confusing rejection into a fixable one.
  const actual = Object.values(ALLOWED_TYPES).find(
    (type) =>
      type.signatures.length > 0 &&
      type.signatures.every((signature) => matches(head, signature)),
  );

  return {
    ok: false,
    reason: actual
      ? `That file is a ${actual.extension.toUpperCase()}, not a ${claimed.extension.toUpperCase()}.`
      : `That file is not a valid ${claimed.extension.toUpperCase()}.`,
  };
}
