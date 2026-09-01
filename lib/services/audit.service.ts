import "server-only";
import { db, type DbClient } from "@/lib/db";
import { log } from "@/lib/logger";
import type { Actor } from "@/lib/actor/types";
import type { AuditAction } from "@/generated/prisma/enums";

const auditLog = log("audit");

/**
 * Audit trail for privileged mutations (CLAUDE.md 11).
 *
 * `record` takes an optional transaction client and callers pass the one from
 * their mutation, so the audit row commits or rolls back with the change it
 * describes. An audit gap can never outlive a successful write
 * (docs/ARCHITECTURE.md 4.5).
 */

export type AuditInput = {
  actor: Actor;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
};

/** Fields never written to the audit trail, in any entity. */
const SENSITIVE_KEYS = new Set([
  "passwordHash",
  "password",
  "passwordResetToken",
  "inviteToken",
  "gatewaySignature",
  "secret",
  "apiKey",
]);

/**
 * Strip secrets before persisting a before/after snapshot. An audit log that
 * captures a password hash has turned the safety feature into a liability.
 */
/**
 * Decimal instances are objects, so without this guard a money value would be
 * recursed into and stored as its internal {s, e, d} representation instead of
 * a number. The check is structural rather than `instanceof` because both
 * decimal.js and Prisma's own Decimal reach here and they are different
 * classes — they share this shape.
 */
function isDecimalLike(value: object): boolean {
  return (
    "s" in value &&
    "e" in value &&
    "d" in value &&
    typeof (value as { toFixed?: unknown }).toFixed === "function"
  );
}

export function sanitizeSnapshot(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (isDecimalLike(value)) return String(value);
  if (Array.isArray(value)) return value.map(sanitizeSnapshot);

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEYS.has(key) ? "[redacted]" : sanitizeSnapshot(val);
  }
  return out;
}

export async function record(input: AuditInput, tx: DbClient = db): Promise<void> {
  const { actor, action, entityType, entityId } = input;

  await tx.auditLog.create({
    data: {
      // A SYSTEM actor has no User row; the null actorId plus the action is the
      // record that automation did this.
      actorId: actor.type === "SYSTEM" ? null : actor.userId,
      action,
      entityType,
      entityId,
      before: input.before === undefined ? undefined : (sanitizeSnapshot(input.before) as object),
      after: input.after === undefined ? undefined : (sanitizeSnapshot(input.after) as object),
      ip: actor.ip,
      userAgent: actor.userAgent,
    },
  });

  auditLog.info({ actorId: actor.userId, action, entityType, entityId }, "audited");
}

/**
 * Run a mutation and its audit row in one transaction.
 *
 * Usage:
 *   const lead = await withAudit(
 *     { actor, action: "UPDATE", entityType: "Lead", entityId: id, before },
 *     (tx) => tx.lead.update({ where: { id }, data }),
 *   );
 */
export async function withAudit<T>(
  input: Omit<AuditInput, "after"> & { after?: unknown },
  mutate: (tx: DbClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const result = await mutate(tx);
    await record({ ...input, after: input.after ?? result }, tx);
    return result;
  });
}
