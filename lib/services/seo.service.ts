import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import type { Actor } from "@/lib/actor/types";
import type { PageSeoInput } from "@/lib/validation/seo";

/**
 * SEO for any entity that carries the shared `Seo` relation.
 *
 * CLAUDE.md 9 requires every indexable entity to carry the full set — meta,
 * canonical, OG including image alt, Twitter, robots and schema type — through
 * one reusable relation. The relation existed from the start; what did not was
 * anywhere to edit most of it. Cities had no SEO fields at all, and packages
 * and service-city pages had a meta title and description and nothing else, so
 * their social cards and indexability were unmanageable.
 *
 * One function serves all of them rather than each module growing its own
 * copy of the upsert (CLAUDE.md 4).
 */

export const SEO_ENTITIES = {
  city: { tag: "cities", label: "City" },
  serviceCityPage: { tag: "service-city-pages", label: "Service-city page" },
  servicePackage: { tag: "packages", label: "Package" },
  service: { tag: "services", label: "Service" },
  blogPost: { tag: "posts", label: "Blog post" },
  caseStudy: { tag: "case-studies", label: "Case study" },
} as const;

export type SeoEntity = keyof typeof SEO_ENTITIES;

export function isSeoEntity(value: string): value is SeoEntity {
  return Object.prototype.hasOwnProperty.call(SEO_ENTITIES, value);
}

/**
 * The fields the panel edits. One fragment, so no caller can read a narrower
 * set and silently drop a field from the form.
 */
const entitySeoSelect = {
  id: true,
  seoId: true,
  seo: {
    select: {
      id: true,
      metaTitle: true,
      metaDescription: true,
      canonical: true,
      ogTitle: true,
      ogDescription: true,
      ogImageId: true,
      ogImageAlt: true,
      twitterTitle: true,
      twitterDescription: true,
      twitterImageId: true,
      robotsIndex: true,
      robotsFollow: true,
      schemaType: true,
    },
  },
} as const;

/**
 * Switched rather than indexed: the entity name arrives from a form field, and
 * `db[whatever]` would let a caller reach any table in the schema. Prisma's
 * delegates are also not callable as a union, so each branch names its own.
 */
function readEntity(entity: SeoEntity, id: string) {
  switch (entity) {
    case "city":
      return db.city.findUnique({ where: { id }, select: entitySeoSelect });
    case "serviceCityPage":
      return db.serviceCityPage.findUnique({ where: { id }, select: entitySeoSelect });
    case "servicePackage":
      return db.servicePackage.findUnique({ where: { id }, select: entitySeoSelect });
    case "service":
      return db.service.findUnique({ where: { id }, select: entitySeoSelect });
    case "blogPost":
      return db.blogPost.findUnique({ where: { id }, select: entitySeoSelect });
    case "caseStudy":
      return db.caseStudy.findUnique({ where: { id }, select: entitySeoSelect });
  }
}

/** Read an entity's SEO. */
export async function getEntitySeo(actor: Actor, entity: SeoEntity, id: string) {
  requirePermission(actor, "seo.view");

  const row = await readEntity(entity, id);

  if (!row) throw new NotFoundError(`That ${SEO_ENTITIES[entity].label.toLowerCase()} does not exist.`);
  return row;
}

/**
 * Save an entity's SEO, creating the record on first save.
 *
 * Gated on `seo.edit`, not the entity's own edit permission: tuning metadata
 * and rewriting a package's price are different responsibilities, and the
 * permission catalogue already separates them.
 */
export async function updateEntitySeo(
  actor: Actor,
  entity: SeoEntity,
  id: string,
  input: PageSeoInput,
) {
  requirePermission(actor, "seo.edit");

  if (!isSeoEntity(entity)) throw new ValidationError("Unknown entity.");
  const before = await getEntitySeo(actor, entity, id);

  const data = {
    metaTitle: input.metaTitle,
    metaDescription: input.metaDescription,
    canonical: input.canonical,
    ogTitle: input.ogTitle,
    ogDescription: input.ogDescription,
    ogImageId: input.ogImageId,
    ogImageAlt: input.ogImageAlt,
    twitterTitle: input.twitterTitle,
    twitterDescription: input.twitterDescription,
    twitterImageId: input.twitterImageId,
    robotsIndex: input.robotsIndex,
    robotsFollow: input.robotsFollow,
    schemaType: input.schemaType,
  };

  await withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: `${SEO_ENTITIES[entity].label} SEO`,
      entityId: id,
      before: before.seo,
    },
    async (tx) => {
      if (before.seoId) return tx.seo.update({ where: { id: before.seoId }, data });

      // Created first and linked by id: Prisma will not accept a nested
      // relation create alongside scalar foreign keys in the same call.
      const seo = await tx.seo.create({ data });
      switch (entity) {
        case "city":
          return tx.city.update({ where: { id }, data: { seoId: seo.id } });
        case "serviceCityPage":
          return tx.serviceCityPage.update({ where: { id }, data: { seoId: seo.id } });
        case "servicePackage":
          return tx.servicePackage.update({ where: { id }, data: { seoId: seo.id } });
        case "service":
          return tx.service.update({ where: { id }, data: { seoId: seo.id } });
        case "blogPost":
          return tx.blogPost.update({ where: { id }, data: { seoId: seo.id } });
        case "caseStudy":
          return tx.caseStudy.update({ where: { id }, data: { seoId: seo.id } });
      }
    },
  );

  revalidateTag(SEO_ENTITIES[entity].tag);
  return getEntitySeo(actor, entity, id);
}
