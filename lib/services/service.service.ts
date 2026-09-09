import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { CACHE_TAGS } from "@/lib/content/queries";
import { SchemaType } from "@/generated/prisma/enums";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
import type { Actor } from "@/lib/actor/types";
import type { ServiceInput } from "@/lib/validation/content";

/**
 * Services.
 *
 * The `Service` row is the spine of the local SEO system — every
 * `ServiceCityPage` is a service crossed with a city — and until now it could
 * only be created by the demo seed. This is the missing admin write path, on
 * the same `catalog.*` permissions as cities and packages.
 *
 * SEO is deliberately not written here. It has its own panel and its own
 * permission (`seo.edit`), so an ordinary edit by someone without it cannot
 * wipe the metadata (CLAUDE.md 4).
 */

export async function listServices(actor: Actor) {
  requirePermission(actor, "catalog.view");

  return db.service.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      shortDescription: true,
      icon: true,
      status: true,
      order: true,
      _count: { select: { cityPages: true, packages: true, caseStudies: true, leads: true } },
    },
  });
}

export type ServiceRow = Awaited<ReturnType<typeof listServices>>[number];

export async function getService(actor: Actor, id: string) {
  requirePermission(actor, "catalog.view");

  const service = await db.service.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      name: true,
      shortDescription: true,
      icon: true,
      heroMediaId: true,
      heroMedia: { select: { id: true, url: true, alt: true } },
      body: true,
      status: true,
      order: true,
      seoId: true,
      seo: { select: { id: true, metaTitle: true, metaDescription: true } },
    },
  });

  if (!service) throw new NotFoundError("That service does not exist.");
  return service;
}

async function assertSlugFree(slug: string, excludeId?: string): Promise<void> {
  const clash = await db.service.findFirst({
    where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    const message = "Another service already uses that slug.";
    throw new ConflictError(message, { slug: [message] });
  }
}

export async function createService(actor: Actor, input: ServiceInput) {
  requirePermission(actor, "catalog.create");
  if (input.status === "PUBLISHED") requirePermission(actor, "catalog.publish");
  await assertSlugFree(input.slug);

  const service = await withAudit(
    { actor, action: "CREATE", entityType: "Service", entityId: input.slug },
    async (tx) => {
      // Created empty and linked; the SEO panel on the service's own screen
      // fills it in.
      const seo = await tx.seo.create({ data: { schemaType: SchemaType.NONE } });

      return tx.service.create({
        data: {
          name: input.name,
          slug: input.slug,
          shortDescription: input.shortDescription,
          icon: input.icon,
          heroMediaId: input.heroMediaId,
          body: input.body as InputJsonValue,
          status: input.status,
          order: input.order,
          seoId: seo.id,
        },
      });
    },
  );

  revalidateTag(CACHE_TAGS.services);
  return service;
}

export async function updateService(actor: Actor, id: string, input: ServiceInput) {
  requirePermission(actor, "catalog.edit");

  const before = await getService(actor, id);
  if (input.status === "PUBLISHED" && before.status !== "PUBLISHED") {
    requirePermission(actor, "catalog.publish");
  }
  await assertSlugFree(input.slug, id);

  const service = await withAudit(
    { actor, action: "UPDATE", entityType: "Service", entityId: id, before },
    (tx) =>
      tx.service.update({
        where: { id },
        data: {
          name: input.name,
          slug: input.slug,
          shortDescription: input.shortDescription,
          icon: input.icon,
          heroMediaId: input.heroMediaId,
          body: input.body as InputJsonValue,
          status: input.status,
          order: input.order,
        },
      }),
  );

  revalidateTag(CACHE_TAGS.services);
  // A service's name and slug are rendered by its city pages too.
  revalidateTag("service-city-pages");
  return service;
}

/**
 * Delete a service.
 *
 * `Service` has no soft delete, and its city pages, packages, case studies and
 * leads reference it. Rather than cascade a hard delete through published
 * content — or lose the service a lead was captured against — this refuses
 * while anything depends on it and says what. Archiving is the way to retire
 * one.
 */
export async function deleteService(actor: Actor, id: string) {
  requirePermission(actor, "catalog.delete");

  const service = await db.service.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { cityPages: true, packages: true, caseStudies: true, leads: true } },
    },
  });
  if (!service) throw new NotFoundError("That service does not exist.");

  const blockers: string[] = [];
  const { cityPages, packages, caseStudies, leads } = service._count;
  if (cityPages > 0) blockers.push(`${cityPages} city page${cityPages === 1 ? "" : "s"}`);
  if (packages > 0) blockers.push(`${packages} package${packages === 1 ? "" : "s"}`);
  if (caseStudies > 0) blockers.push(`${caseStudies} case stud${caseStudies === 1 ? "y" : "ies"}`);
  if (leads > 0) blockers.push(`${leads} lead${leads === 1 ? "" : "s"}`);

  if (blockers.length > 0) {
    throw new ConflictError(
      `This service is used by ${blockers.join(", ")}. Set it to Archived instead of deleting it.`,
    );
  }

  await withAudit(
    { actor, action: "DELETE", entityType: "Service", entityId: id, before: service },
    (tx) => tx.service.delete({ where: { id } }),
  );

  revalidateTag(CACHE_TAGS.services);
}
