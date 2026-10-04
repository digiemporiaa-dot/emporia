import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { record } from "@/lib/services/audit.service";
import { DEFAULT_THRESHOLDS, isThresholdKey, mergeThresholds, THRESHOLD_DEFS, THRESHOLD_KEYS, type ThresholdKey, type Thresholds } from "@/lib/seo-intel/thresholds";
import type { Actor } from "@/lib/actor/types";

/**
 * Rule settings: agency defaults with per-website overrides (Phase 10).
 * Every rule-running service reads the merged values through
 * `thresholdsFor`, so screens and the detector agree.
 */

/** Defaults ← agency ← website. No actor: callers have already scoped the website. */
export async function thresholdsFor(propertyId: string): Promise<Thresholds> {
  const rows = await db.seoThreshold.findMany({ where: { OR: [{ propertyId: null }, { propertyId }] }, select: { propertyId: true, key: true, value: true } });
  return mergeThresholds(
    rows.filter((row) => row.propertyId === null),
    rows.filter((row) => row.propertyId === propertyId),
  );
}

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

export async function thresholdSettings(actor: Actor, propertyId: string | null) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  if (propertyId) {
    const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true } });
    if (!property) throw new NotFoundError("That website was not found.");
  }
  const rows = await db.seoThreshold.findMany({
    where: propertyId ? { OR: [{ propertyId: null }, { propertyId }] } : { propertyId: null },
    select: { propertyId: true, key: true, value: true },
  });
  const agency = mergeThresholds(rows.filter((row) => row.propertyId === null));
  const overrides = new Map(rows.filter((row) => row.propertyId !== null && isThresholdKey(row.key)).map((row) => [row.key as ThresholdKey, row.value]));
  return {
    defaults: DEFAULT_THRESHOLDS,
    agency,
    overrides: Object.fromEntries(overrides) as Partial<Thresholds>,
    effective: propertyId ? await thresholdsFor(propertyId) : agency,
  };
}

/**
 * Save values for a scope. A null value removes the setting (back to the
 * agency default, or for the agency back to the built-in default). Values
 * outside a setting's range are refused rather than silently clamped.
 */
export async function saveThresholds(actor: Actor, propertyId: string | null, values: Partial<Record<string, number | null>>) {
  requirePermission(actor, propertyId ? "seo.intelligence.manage" : "seo.intelligence.connect");
  staffOnly(actor);
  for (const [key, value] of Object.entries(values)) {
    if (!isThresholdKey(key)) throw new ValidationError(`Unknown setting: ${key}.`);
    if (value === null || value === undefined) continue;
    const def = THRESHOLD_DEFS[key];
    if (!Number.isFinite(value) || value < def.min || value > def.max) {
      throw new ValidationError(`${def.label} must be between ${def.min} and ${def.max}.`, { field: key });
    }
  }
  if (propertyId) {
    const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true } });
    if (!property) throw new NotFoundError("That website was not found.");
  }

  await db.$transaction(async (tx) => {
    // One row per scope and key: decided under a lock, since a null scope
    // cannot be made unique by an ordinary index.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-thresholds:${propertyId ?? "agency"}`}))`;
    const before = await tx.seoThreshold.findMany({ where: { propertyId }, select: { key: true, value: true } });
    for (const key of THRESHOLD_KEYS) {
      if (!(key in values)) continue;
      const value = values[key];
      await tx.seoThreshold.deleteMany({ where: { propertyId, key } });
      if (value !== null && value !== undefined) {
        await tx.seoThreshold.create({ data: { propertyId, key, value, updatedById: actor.type === "STAFF" ? actor.userId : null } });
      }
    }
    const after = await tx.seoThreshold.findMany({ where: { propertyId }, select: { key: true, value: true } });
    await record({ actor, action: "UPDATE", entityType: "SeoThreshold", entityId: propertyId ?? "agency", before, after }, tx);
  });
}
