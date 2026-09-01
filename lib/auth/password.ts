import "server-only";
import argon2 from "argon2";

/**
 * Password hashing. argon2id with parameters above the OWASP minimum.
 * Passwords are never logged and never returned from a service (CLAUDE.md 11).
 */

// `raw: false` keeps the string overload of argon2.hash — with `raw: true` it
// returns a Buffer, which is not what we persist.
const OPTIONS: argon2.HashOptions & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
  raw: false,
};

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 12) {
    throw new Error("Password must be at least 12 characters.");
  }
  return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // A malformed hash is a verification failure, not a crash.
    return false;
  }
}
