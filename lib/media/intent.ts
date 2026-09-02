import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/config/env";
import { ValidationError } from "@/lib/errors";

/**
 * Upload intents.
 *
 * Between presigning and confirming, the server has to remember what it agreed
 * to: which key, which type, which exact size, for which user. Rather than a
 * pending row and a sweeper to clean it up, the intent is signed with the app
 * secret and handed to the browser as an opaque id.
 *
 * The confirm step therefore cannot be driven by a caller-supplied key: an
 * unsigned or tampered intent fails verification, and one signed for another
 * user is refused (CLAUDE.md 11).
 */

export type UploadIntent = {
  key: string;
  mime: string;
  size: number;
  filename: string;
  alt: string | null;
  folderId: string | null;
  replacesId: string | null;
  userId: string;
  /** Unix seconds. */
  exp: number;
};

/** Slightly longer than the presigned URL, so a slow upload can still confirm. */
export const INTENT_TTL_SECONDS = 900;

function secret(): Buffer {
  return Buffer.from(env().AUTH_SECRET, "utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeIntent(intent: UploadIntent): string {
  const payload = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeIntent(token: string, now = Date.now()): UploadIntent {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) throw new ValidationError("That upload is not valid.");

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  // Constant-time, and length-checked first because timingSafeEqual throws on
  // a length mismatch.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ValidationError("That upload is not valid.");
  }

  let intent: UploadIntent;
  try {
    intent = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as UploadIntent;
  } catch {
    throw new ValidationError("That upload is not valid.");
  }

  if (!intent.key || !intent.mime || !intent.userId || typeof intent.exp !== "number") {
    throw new ValidationError("That upload is not valid.");
  }

  if (intent.exp * 1000 < now) {
    throw new ValidationError("That upload expired before it finished. Try again.");
  }

  return intent;
}
