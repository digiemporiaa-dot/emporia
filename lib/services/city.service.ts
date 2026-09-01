import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import type { Actor } from "@/lib/actor/types";
import type { CityInput } from "@/lib/validation/local";

/**
 * City CMS.
 *
 * Every mutation checks a permission before doing work and writes an audit row
 * in the same transaction as the change (CLAUDE.md 2 rule 2, 11).
 */

export const CITY_TAG = "cities";

export async function listCities(actor: Actor) {
  requirePermission(actor, "catalog.view");

  return db.city.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      state: true,
      country: true,
      latitude: true,
      longitude: true,
      population: true,
      isActive: true,
      order: true,
      _count: { select: { servicePages: true } },
    },
  });
}

export async function getCity(actor: Actor, id: string) {
  requirePermission(actor, "catalog.view");

  const city = await db.city.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      name: true,
      state: true,
      country: true,
      latitude: true,
      longitude: true,
      population: true,
      isActive: true,
      order: true,
    },
  });

  if (!city) throw new NotFoundError("That city does not exist.");
  return city;
}

async function assertSlugFree(slug: string, excludeId?: string): Promise<void> {
  const clash = await db.city.findFirst({
    where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ConflictError("Another city already uses that slug.");
}

export async function createCity(actor: Actor, input: CityInput) {
  requirePermission(actor, "catalog.create");
  await assertSlugFree(input.slug);

  const city = await withAudit(
    { actor, action: "CREATE", entityType: "City", entityId: input.slug },
    (tx) =>
      tx.city.create({
        data: {
          name: input.name,
          slug: input.slug,
          state: input.state,
          country: input.country,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          population: input.population ?? null,
          isActive: input.isActive,
          order: input.order,
        },
      }),
  );

  revalidateTag(CITY_TAG);
  return city;
}

export async function updateCity(actor: Actor, id: string, input: CityInput) {
  requirePermission(actor, "catalog.edit");

  const before = await getCity(actor, id);
  await assertSlugFree(input.slug, id);

  const city = await withAudit(
    { actor, action: "UPDATE", entityType: "City", entityId: id, before },
    (tx) =>
      tx.city.update({
        where: { id },
        data: {
          name: input.name,
          slug: input.slug,
          state: input.state,
          country: input.country,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          population: input.population ?? null,
          isActive: input.isActive,
          order: input.order,
        },
      }),
  );

  revalidateTag(CITY_TAG);
  return city;
}

/**
 * Deactivating a city hides it and its local pages from the public site.
 * There is no hard delete: a city with published pages behind it is history
 * worth keeping, and removing it would break URLs.
 */
export async function setCityActive(actor: Actor, id: string, isActive: boolean) {
  requirePermission(actor, "catalog.edit");
  const before = await getCity(actor, id);

  const city = await withAudit(
    {
      actor,
      action: isActive ? "PUBLISH" : "UNPUBLISH",
      entityType: "City",
      entityId: id,
      before,
    },
    (tx) => tx.city.update({ where: { id }, data: { isActive } }),
  );

  revalidateTag(CITY_TAG);
  return city;
}

export async function reorderCities(actor: Actor, ordered: readonly { id: string; order: number }[]) {
  requirePermission(actor, "catalog.edit");

  await db.$transaction(async (tx) => {
    for (const item of ordered) {
      await tx.city.update({ where: { id: item.id }, data: { order: item.order } });
    }
    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "City",
        entityId: "reorder",
        after: { ordered },
      },
      tx,
    );
  });

  revalidateTag(CITY_TAG);
}
