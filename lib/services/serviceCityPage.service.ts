import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { canPublish, type PublishCheck, type SiblingContent } from "@/lib/local/can-publish";
import { SchemaType } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";
import type { ServiceCityPageInput, LocalFaqInput } from "@/lib/validation/local";

/**
 * Service x City pages.
 *
 * Generated from the database — never hand-written React pages (CLAUDE.md 9).
 *
 * `publish()` is the only route to PUBLISHED and it calls `canPublish` first,
 * so a thin page cannot become indexable. The same check is used by the public
 * route to force noindex and by the sitemap query, meaning there is no path
 * around it.
 */

export const SERVICE_CITY_TAG = "service-city-pages";

const pageSelect = {
  id: true,
  status: true,
  publishedAt: true,
  localIntro: true,
  marketContext: true,
  industries: true,
  positioning: true,
  ctaHeading: true,
  ctaBody: true,
  service: { select: { id: true, slug: true, name: true } },
  city: { select: { id: true, slug: true, name: true, state: true, isActive: true } },
  seo: { select: { id: true, metaTitle: true, metaDescription: true, canonical: true } },
  faqs: {
    orderBy: { order: "asc" as const },
    select: { id: true, question: true, answer: true, order: true, isActive: true },
  },
} as const;

export type ServiceCityPageRecord = Awaited<ReturnType<typeof getPage>>;

export async function listPages(actor: Actor) {
  requirePermission(actor, "catalog.view");

  return db.serviceCityPage.findMany({
    orderBy: [{ service: { order: "asc" } }, { city: { order: "asc" } }],
    select: {
      id: true,
      status: true,
      publishedAt: true,
      service: { select: { id: true, slug: true, name: true } },
      city: { select: { id: true, slug: true, name: true, isActive: true } },
      _count: { select: { faqs: true } },
    },
  });
}

export async function getPage(actor: Actor, id: string) {
  requirePermission(actor, "catalog.view");

  const page = await db.serviceCityPage.findUnique({ where: { id }, select: pageSelect });
  if (!page) throw new NotFoundError("That local page does not exist.");
  return page;
}

/** Published sibling pages for the same service, for the uniqueness comparison. */
async function siblingsFor(serviceId: string, excludePageId?: string): Promise<SiblingContent[]> {
  const rows = await db.serviceCityPage.findMany({
    where: {
      serviceId,
      ...(excludePageId ? { id: { not: excludePageId } } : {}),
    },
    select: {
      id: true,
      localIntro: true,
      marketContext: true,
      city: { select: { name: true } },
      seo: { select: { metaTitle: true, metaDescription: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    cityName: row.city.name,
    localIntro: row.localIntro,
    marketContext: row.marketContext,
    metaTitle: row.seo?.metaTitle ?? null,
    metaDescription: row.seo?.metaDescription ?? null,
  }));
}

/** Count case studies and testimonials that evidence work in this city or service. */
async function localProofCount(serviceId: string, cityId: string): Promise<number> {
  const [caseStudies, testimonials] = await Promise.all([
    db.caseStudy.count({
      where: { status: "PUBLISHED", OR: [{ cityId }, { serviceId, cityId }] },
    }),
    db.testimonial.count({
      where: { status: "PUBLISHED", OR: [{ cityId }, { serviceId, cityId }] },
    }),
  ]);
  return caseStudies + testimonials;
}

/**
 * Evaluate publishability. Exposed so the admin can show progress before the
 * author attempts to publish, rather than only failing at the last step.
 */
export async function checkPublishable(actor: Actor, id: string): Promise<PublishCheck> {
  const page = await getPage(actor, id);
  return evaluatePage(page);
}

/** Internal form, so public routes can evaluate without an actor. */
export async function evaluatePage(page: {
  id: string;
  localIntro: string | null;
  marketContext: string | null;
  industries: unknown;
  positioning: string | null;
  ctaHeading: string | null;
  ctaBody: string | null;
  service: { id: string };
  city: { id: string; name: string; state: string };
  seo: { metaTitle: string | null; metaDescription: string | null } | null;
  faqs: { isActive: boolean }[];
}): Promise<PublishCheck> {
  const [siblings, proof] = await Promise.all([
    siblingsFor(page.service.id, page.id),
    localProofCount(page.service.id, page.city.id),
  ]);

  return canPublish(
    {
      localIntro: page.localIntro,
      marketContext: page.marketContext,
      industries: page.industries,
      positioning: page.positioning,
      ctaHeading: page.ctaHeading,
      ctaBody: page.ctaBody,
      faqCount: page.faqs.filter((f) => f.isActive).length,
      localProofCount: proof,
      seo: page.seo,
      localTokens: [page.city.name, page.city.state],
    },
    siblings,
  );
}

export async function createPage(actor: Actor, input: ServiceCityPageInput) {
  requirePermission(actor, "catalog.create");

  const existing = await db.serviceCityPage.findUnique({
    where: { serviceId_cityId: { serviceId: input.serviceId, cityId: input.cityId } },
    select: { id: true },
  });
  if (existing) throw new ConflictError("A page already exists for that service and city.");

  const page = await withAudit(
    { actor, action: "CREATE", entityType: "ServiceCityPage", entityId: `${input.serviceId}:${input.cityId}` },
    async (tx) => {
      // The Seo row is created first and linked by id: Prisma will not accept a
      // nested relation create alongside scalar foreign keys in the same call.
      const seo = await tx.seo.create({
        data: {
          metaTitle: input.metaTitle ?? null,
          metaDescription: input.metaDescription ?? null,
          canonical: input.canonical ?? null,
          schemaType: SchemaType.LOCAL_BUSINESS,
        },
      });

      return tx.serviceCityPage.create({
        data: {
          serviceId: input.serviceId,
          cityId: input.cityId,
          localIntro: input.localIntro ?? null,
          marketContext: input.marketContext ?? null,
          industries: input.industries,
          positioning: input.positioning ?? null,
          ctaHeading: input.ctaHeading ?? null,
          ctaBody: input.ctaBody ?? null,
          status: "DRAFT",
          seoId: seo.id,
        },
      });
    },
  );

  revalidateTag(SERVICE_CITY_TAG);
  return page;
}

export async function updatePage(actor: Actor, id: string, input: ServiceCityPageInput) {
  requirePermission(actor, "catalog.edit");
  const before = await getPage(actor, id);

  const page = await withAudit(
    { actor, action: "UPDATE", entityType: "ServiceCityPage", entityId: id, before },
    async (tx) => {
      const updated = await tx.serviceCityPage.update({
        where: { id },
        data: {
          localIntro: input.localIntro ?? null,
          marketContext: input.marketContext ?? null,
          industries: input.industries,
          positioning: input.positioning ?? null,
          ctaHeading: input.ctaHeading ?? null,
          ctaBody: input.ctaBody ?? null,
        },
      });

      // Upsert the Seo record rather than assuming one exists.
      if (before.seo) {
        await tx.seo.update({
          where: { id: before.seo.id },
          data: {
            metaTitle: input.metaTitle ?? null,
            metaDescription: input.metaDescription ?? null,
            canonical: input.canonical ?? null,
          },
        });
      } else {
        const seo = await tx.seo.create({
          data: {
            metaTitle: input.metaTitle ?? null,
            metaDescription: input.metaDescription ?? null,
            canonical: input.canonical ?? null,
            schemaType: SchemaType.LOCAL_BUSINESS,
          },
        });
        await tx.serviceCityPage.update({ where: { id }, data: { seoId: seo.id } });
      }

      return updated;
    },
  );

  revalidateTag(SERVICE_CITY_TAG);
  return page;
}

/**
 * The publish gate.
 *
 * This is the enforcement CLAUDE.md 9 asks for: a page that fails canPublish
 * cannot be set to PUBLISHED, and the reasons come back to the caller rather
 * than being swallowed.
 */
export async function publishPage(actor: Actor, id: string) {
  requirePermission(actor, "catalog.publish");

  const page = await getPage(actor, id);
  const check = await evaluatePage(page);

  if (!check.ok) {
    throw new ValidationError(
      "This page does not have enough genuine local content to publish yet.",
      { reasons: check.reasons, checks: check.checks },
    );
  }

  if (!page.city.isActive) {
    throw new ValidationError("Activate the city before publishing pages for it.");
  }

  const updated = await withAudit(
    { actor, action: "PUBLISH", entityType: "ServiceCityPage", entityId: id, before: page },
    (tx) =>
      tx.serviceCityPage.update({
        where: { id },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      }),
  );

  revalidateTag(SERVICE_CITY_TAG);
  return updated;
}

export async function unpublishPage(actor: Actor, id: string) {
  requirePermission(actor, "catalog.publish");
  const before = await getPage(actor, id);

  const updated = await withAudit(
    { actor, action: "UNPUBLISH", entityType: "ServiceCityPage", entityId: id, before },
    (tx) => tx.serviceCityPage.update({ where: { id }, data: { status: "DRAFT" } }),
  );

  revalidateTag(SERVICE_CITY_TAG);
  return updated;
}

export async function addLocalFaq(actor: Actor, input: LocalFaqInput) {
  requirePermission(actor, "catalog.edit");

  const faq = await withAudit(
    { actor, action: "CREATE", entityType: "FAQ", entityId: input.serviceCityPageId },
    (tx) =>
      tx.fAQ.create({
        data: {
          serviceCityPageId: input.serviceCityPageId,
          question: input.question,
          answer: input.answer,
          order: input.order,
          isActive: true,
        },
      }),
  );

  revalidateTag(SERVICE_CITY_TAG);
  return faq;
}

export async function deleteLocalFaq(actor: Actor, id: string) {
  requirePermission(actor, "catalog.edit");

  const before = await db.fAQ.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("That FAQ does not exist.");

  await withAudit(
    { actor, action: "DELETE", entityType: "FAQ", entityId: id, before },
    (tx) => tx.fAQ.delete({ where: { id } }),
  );

  revalidateTag(SERVICE_CITY_TAG);
}
