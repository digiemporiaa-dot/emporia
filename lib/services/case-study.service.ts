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
import type { CaseStudyInput } from "@/lib/validation/content";

/**
 * Case studies.
 *
 * Metrics are the reason this needs care. They are the numbers the agency
 * publishes about a client's results, they are stored as strings exactly as
 * written, and nothing in this system computes, aggregates or infers one
 * (CLAUDE.md 2 rules 1 and 5). An editor types what the client agreed, or the
 * metric does not exist.
 */

export async function listCaseStudies(actor: Actor) {
  requirePermission(actor, "casestudies.view");

  return db.caseStudy.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      slug: true,
      title: true,
      clientName: true,
      status: true,
      service: { select: { name: true } },
      city: { select: { name: true } },
      _count: { select: { metrics: true } },
    },
  });
}

export type CaseStudyRow = Awaited<ReturnType<typeof listCaseStudies>>[number];

export async function getCaseStudy(actor: Actor, id: string) {
  requirePermission(actor, "casestudies.view");

  const study = await db.caseStudy.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      clientName: true,
      summary: true,
      body: true,
      serviceId: true,
      cityId: true,
      coverId: true,
      cover: { select: { id: true, url: true, alt: true } },
      status: true,
      seoId: true,
      seo: { select: { id: true, metaTitle: true, metaDescription: true } },
      metrics: { orderBy: { order: "asc" }, select: { label: true, value: true, unit: true } },
    },
  });

  if (!study) throw new NotFoundError("That case study does not exist.");
  return study;
}

async function assertSlugFree(slug: string, excludeId?: string): Promise<void> {
  const clash = await db.caseStudy.findFirst({
    where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    const message = "Another case study already uses that slug.";
    throw new ConflictError(message, { slug: [message] });
  }
}

export async function createCaseStudy(actor: Actor, input: CaseStudyInput) {
  requirePermission(actor, "casestudies.create");
  if (input.status === "PUBLISHED") requirePermission(actor, "casestudies.publish");
  await assertSlugFree(input.slug);

  const study = await withAudit(
    { actor, action: "CREATE", entityType: "CaseStudy", entityId: input.slug },
    async (tx) => {
      const seo = await tx.seo.create({ data: { schemaType: SchemaType.NONE } });

      const created = await tx.caseStudy.create({
        data: {
          title: input.title,
          slug: input.slug,
          clientName: input.clientName,
          summary: input.summary,
          body: input.body as InputJsonValue,
          serviceId: input.serviceId,
          cityId: input.cityId,
          coverId: input.coverId,
          status: input.status,
          seoId: seo.id,
        },
      });

      if (input.metrics.length > 0) {
        await tx.caseStudyMetric.createMany({
          data: input.metrics.map((metric, index) => ({
            caseStudyId: created.id,
            label: metric.label,
            value: metric.value,
            unit: metric.unit,
            order: index,
          })),
        });
      }

      return created;
    },
  );

  revalidateTag(CACHE_TAGS.caseStudies);
  return study;
}

export async function updateCaseStudy(actor: Actor, id: string, input: CaseStudyInput) {
  requirePermission(actor, "casestudies.edit");

  const before = await getCaseStudy(actor, id);
  if (input.status === "PUBLISHED" && before.status !== "PUBLISHED") {
    requirePermission(actor, "casestudies.publish");
  }
  await assertSlugFree(input.slug, id);

  const study = await withAudit(
    { actor, action: "UPDATE", entityType: "CaseStudy", entityId: id, before },
    async (tx) => {
      const updated = await tx.caseStudy.update({
        where: { id },
        data: {
          title: input.title,
          slug: input.slug,
          clientName: input.clientName,
          summary: input.summary,
          body: input.body as InputJsonValue,
          serviceId: input.serviceId,
          cityId: input.cityId,
          coverId: input.coverId,
          status: input.status,
        },
      });

      // Ordered and replaced wholesale, which keeps the stored order
      // authoritative rather than reconciling a diff.
      await tx.caseStudyMetric.deleteMany({ where: { caseStudyId: id } });
      if (input.metrics.length > 0) {
        await tx.caseStudyMetric.createMany({
          data: input.metrics.map((metric, index) => ({
            caseStudyId: id,
            label: metric.label,
            value: metric.value,
            unit: metric.unit,
            order: index,
          })),
        });
      }

      return updated;
    },
  );

  revalidateTag(CACHE_TAGS.caseStudies);
  return study;
}

/**
 * Set the publication status, without touching anything else.
 *
 * Separate from `updateCaseStudy` because bulk actions and the list screens need to
 * publish a record without reconstructing its whole input — and reconstructing
 * it is how a bulk action quietly overwrites a field nobody meant to change.
 * Publishing needs `casestudies.publish`; anything else is an ordinary edit.
 */
export async function setCaseStudyStatus(
  actor: Actor,
  id: string,
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED",
) {
  requirePermission(actor, status === "PUBLISHED" ? "casestudies.publish" : "casestudies.edit");

  const before = await getCaseStudy(actor, id);

  const updated = await withAudit(
    {
      actor,
      action: status === "PUBLISHED" ? "PUBLISH" : "UNPUBLISH",
      entityType: "CaseStudy",
      entityId: id,
      before,
    },
    (tx) => tx.caseStudy.update({ where: { id }, data: { status } }),
  );

  revalidateTag(CACHE_TAGS.caseStudies);
  return updated;
}

export async function deleteCaseStudy(actor: Actor, id: string) {
  requirePermission(actor, "casestudies.delete");

  const before = await getCaseStudy(actor, id);

  await withAudit(
    { actor, action: "DELETE", entityType: "CaseStudy", entityId: id, before },
    (tx) => tx.caseStudy.delete({ where: { id } }),
  );

  revalidateTag(CACHE_TAGS.caseStudies);
}
