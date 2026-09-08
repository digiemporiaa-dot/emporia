import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/config/env";

/**
 * Encryption at rest for credentials an admin enters through the UI.
 *
 * One utility for every such secret — the Meta Conversions API token, the AI
 * provider's API key, and whatever comes next. Each is a bearer credential:
 * anyone holding it can spend money in the account it belongs to. They are
 * stored encrypted so a database dump, a backup file or a stray query result
 * does not hand one over in plain text (CLAUDE.md 11).
 *
 * AES-256-GCM, which authenticates as well as encrypts — a tampered ciphertext
 * fails to decrypt rather than yielding a different token. The key is derived
 * from AUTH_SECRET rather than being a new environment variable to forget:
 * AUTH_SECRET is already required, already at least 32 characters, already
 * server-only, and already the thing whose rotation invalidates sessions.
 *
 * The consequence is written down where it matters: rotating AUTH_SECRET makes
 * an existing stored secret undecryptable. `decryptSecret` returns null rather
 * than throwing, so the app keeps working and the admin shows the credential as
 * needing to be entered again.
 *
 * There is deliberately no second `SETTINGS_ENCRYPTION_KEY` to configure. A key
 * that must be set separately is a key someone forgets on the first deploy, and
 * AUTH_SECRET is already mandatory, already long enough, already server-only
 * and already the thing whose rotation invalidates sessions.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const VERSION = "v1";

function key(): Buffer {
  // A hash, not the raw secret: AUTH_SECRET is a base64 string of arbitrary
  // length and AES-256 needs exactly 32 bytes.
  return createHash("sha256").update(env().AUTH_SECRET).digest();
}

/** `v1.<iv>.<authTag>.<ciphertext>`, all base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Returns null for anything that does not decrypt — a rotated AUTH_SECRET, a
 * truncated value, a tampered one. Never throws, because a bad stored secret
 * must not take down the page that reads the settings.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;

  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const [, ivPart, tagPart, dataPart] = parts;
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart!, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart!, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart!, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * What the admin shows instead of a token: the last four characters only,
 * enough to tell two tokens apart and not enough to use one.
 */
export function maskSecret(plain: string | null): string | null {
  if (!plain) return null;
  return `••••••••••••${plain.slice(-4)}`;
}
