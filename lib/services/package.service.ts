import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { SchemaType } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";
import type { PackageInput } from "@/lib/validation/package";

/**
 * Package CMS.
 *
 * Prices stay strings from the form to the Decimal column; nothing here casts
 * money to a number (CLAUDE.md 2 rule 1).
 */

export const PACKAGE_TAG = "packages";

export async function listPackages(actor: Actor) {
  requirePermission(actor, "catalog.view");

  return db.servicePackage.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      price: true,
      currency: true,
      taxRate: true,
      billingType: true,
      status: true,
      isRecommended: true,
      order: true,
      service: { select: { name: true } },
      _count: { select: { features: true, leads: true } },
    },
  });
}

export async function getPackage(actor: Actor, id: string) {
  requirePermission(actor, "catalog.view");

  const pkg = await db.servicePackage.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      name: true,
      tagline: true,
      price: true,
      currency: true,
      taxRate: true,
      billingType: true,
      isRecommended: true,
      status: true,
      order: true,
      serviceId: true,
      seo: { select: { id: true, metaTitle: true, metaDescription: true } },
      features: {
        orderBy: { order: "asc" },
        select: { id: true, label: true, detail: true, isIncluded: true, order: true },
      },
    },
  });

  if (!pkg) throw new NotFoundError("That package does not exist.");
  return pkg;
}

async function assertSlugFree(slug: string, excludeId?: string): Promise<void> {
  const clash = await db.servicePackage.findFirst({
    where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ConflictError("Another package already uses that slug.");
}

export async function createPackage(actor: Actor, input: PackageInput) {
  requirePermission(actor, "catalog.create");
  if (input.status === "PUBLISHED") requirePermission(actor, "catalog.publish");
  await assertSlugFree(input.slug);

  const pkg = await withAudit(
    { actor, action: "CREATE", entityType: "ServicePackage", entityId: input.slug },
    async (tx) => {
      // Created empty and linked; the SEO panel on the package's own screen
      // fills it in.
      const seo = await tx.seo.create({ data: { schemaType: SchemaType.NONE } });

      const created = await tx.servicePackage.create({
        data: {
          name: input.name,
          slug: input.slug,
          tagline: input.tagline ?? null,
          serviceId: input.serviceId || null,
          price: input.price,
          currency: input.currency,
          billingType: input.billingType,
          taxRate: input.taxRate,
          isRecommended: input.isRecommended,
          status: input.status,
          order: input.order,
          seoId: seo.id,
        },
      });

      if (input.features.length > 0) {
        await tx.packageFeature.createMany({
          data: input.features.map((feature, index) => ({
            packageId: created.id,
            label: feature.label,
            detail: feature.detail ?? null,
            isIncluded: feature.isIncluded,
            order: index,
          })),
        });
      }

      return created;
    },
  );

  revalidateTag(PACKAGE_TAG);
  return pkg;
}

export async function updatePackage(actor: Actor, id: string, input: PackageInput) {
  requirePermission(actor, "catalog.edit");

  const before = await getPackage(actor, id);
  if (input.status === "PUBLISHED" && before.status !== "PUBLISHED") {
    requirePermission(actor, "catalog.publish");
  }
  await assertSlugFree(input.slug, id);

  const pkg = await withAudit(
    { actor, action: "UPDATE", entityType: "ServicePackage", entityId: id, before },
    async (tx) => {
      const updated = await tx.servicePackage.update({
        where: { id },
        data: {
          name: input.name,
          slug: input.slug,
          tagline: input.tagline ?? null,
          serviceId: input.serviceId || null,
          price: input.price,
          currency: input.currency,
          billingType: input.billingType,
          taxRate: input.taxRate,
          isRecommended: input.isRecommended,
          status: input.status,
          order: input.order,
        },
      });

      // SEO is not touched here. It has its own panel and its own permission
      // (`seo.edit`), and a package edit by someone without it must not wipe
      // the metadata (CLAUDE.md 4).

      // Features are ordered and replaced wholesale, which keeps the stored
      // order authoritative rather than reconciling a diff.
      await tx.packageFeature.deleteMany({ where: { packageId: id } });
      if (input.features.length > 0) {
        await tx.packageFeature.createMany({
          data: input.features.map((feature, index) => ({
            packageId: id,
            label: feature.label,
            detail: feature.detail ?? null,
            isIncluded: feature.isIncluded,
            order: index,
          })),
        });
      }

      return updated;
    },
  );

  revalidateTag(PACKAGE_TAG);
  return pkg;
}

/**
 * Set the publication status, without touching anything else.
 *
 * Separate from `updatePackage` because bulk actions and the list screens need
 * to publish a record without reconstructing its whole input — and
 * reconstructing it is how a bulk action quietly overwrites a field nobody
 * meant to change. Publishing needs `catalog.publish`; anything else is an
 * ordinary edit.
 */
export async function setPackageStatus(
  actor: Actor,
  id: string,
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED",
) {
  requirePermission(actor, status === "PUBLISHED" ? "catalog.publish" : "catalog.edit");

  const before = await getPackage(actor, id);

  const updated = await withAudit(
    {
      actor,
      action: status === "PUBLISHED" ? "PUBLISH" : "UNPUBLISH",
      entityType: "ServicePackage",
      entityId: id,
      before,
    },
    (tx) => tx.servicePackage.update({ where: { id }, data: { status } }),
  );

  revalidateTag(PACKAGE_TAG);
  return updated;
}
