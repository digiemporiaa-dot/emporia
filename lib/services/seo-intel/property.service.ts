import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { record } from "@/lib/services/audit.service";
import { ensureCountry } from "@/lib/geo/country-rows";
import { INTERNAL_OWNER, type SeoPropertyCreateInput, type SeoPropertyUpdateInput } from "@/lib/validation/seo-intel";
import type { Actor } from "@/lib/actor/types";
import type { DbClient } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * SEO properties: the websites SEO Intelligence analyses, one or more per
 * client (docs/SEO-INTELLIGENCE-PLAN.md, Part B).
 *
 * Every other SEO table will hang off a property, so this is where client
 * isolation starts. Three rules:
 *
 * - **Staff only for now** (decision D4). A portal user is refused outright,
 *   not narrowed; when the portal gets SEO screens it will read through a
 *   separate, session-scoped path.
 * - **The owner is fixed.** A property never moves to another client — its
 *   history belongs to the client it was gathered for.
 * - **A project must be the same client's.** "Create task" writes into this
 *   project, so a mismatched one would put one client's work in another's
 *   board.
 *
 * The agency's own website belongs to the internal client (decision D1),
 * created the first time it is needed.
 */

function staffOnly(actor: Actor): void {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") {
    throw new ForbiddenError("SEO Intelligence is not available in the client portal yet.");
  }
}

const PROPERTY_SELECT = {
  id: true,
  clientId: true,
  domain: true,
  displayName: true,
  protocol: true,
  verifiedAt: true,
  gscSiteUrl: true,
  ga4PropertyId: true,
  defaultLanguage: true,
  timezone: true,
  isActive: true,
  crawlMaxPages: true,
  crawlFrequency: true,
  nextCrawlAt: true,
  lastCrawledAt: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, name: true, isInternal: true } },
  project: { select: { id: true, code: true, name: true } },
  defaultCountry: { select: { code: true, name: true } },
} satisfies Prisma.SeoPropertySelect;

export type SeoPropertyView = Prisma.SeoPropertyGetPayload<{ select: typeof PROPERTY_SELECT }>;

/** `https://example.com` — the site's root, for links and, later, the crawler's start. */
export function propertyOrigin(property: { protocol: "HTTPS" | "HTTP"; domain: string }): string {
  return `${property.protocol === "HTTPS" ? "https" : "http"}://${property.domain}`;
}

export async function listProperties(
  actor: Actor,
  params: { client?: string; status?: "active" | "inactive" | "all"; q?: string } = {},
): Promise<SeoPropertyView[]> {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);

  const where: Prisma.SeoPropertyWhereInput = {
    client: { deletedAt: null },
    ...(params.client ? { clientId: params.client } : {}),
    ...(params.status === "inactive" ? { isActive: false } : params.status === "all" ? {} : { isActive: true }),
    ...(params.q
      ? {
          OR: [
            { domain: { contains: params.q.toLowerCase() } },
            { displayName: { contains: params.q, mode: "insensitive" } },
            { client: { name: { contains: params.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  return db.seoProperty.findMany({
    where,
    orderBy: [{ client: { name: "asc" } }, { displayName: "asc" }],
    select: PROPERTY_SELECT,
    take: 500,
  });
}

export async function getProperty(actor: Actor, id: string): Promise<SeoPropertyView> {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const property = await db.seoProperty.findFirst({
    where: { id, client: { deletedAt: null } },
    select: PROPERTY_SELECT,
  });
  if (!property) throw new NotFoundError("That SEO property does not exist.");
  return property;
}

/**
 * The agency's own client record, created on first use. Serialised with an
 * advisory lock so two people adding the agency's site at once cannot create
 * two of them.
 */
async function internalClientId(tx: DbClient, actor: Actor): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('seo:internal-client'))`;
  const existing = await tx.client.findFirst({ where: { isInternal: true, deletedAt: null }, select: { id: true } });
  if (existing) return existing.id;

  const setting = await tx.siteSetting.findUnique({ where: { key: "site.name" }, select: { value: true } });
  const name = typeof setting?.value === "string" && setting.value.trim() ? setting.value.trim() : "Our agency";

  let slug = "agency-website";
  for (let n = 2; await tx.client.findUnique({ where: { slug }, select: { id: true } }); n++) slug = `agency-website-${n}`;

  const client = await tx.client.create({
    data: { name, slug, isInternal: true, status: "ACTIVE", ownerId: actor.type === "STAFF" ? actor.userId : null },
    select: { id: true, name: true },
  });
  await record({ actor, action: "CREATE", entityType: "Client", entityId: client.id, after: { ...client, isInternal: true } }, tx);
  return client.id;
}

async function assertClient(tx: DbClient, clientId: string): Promise<void> {
  const client = await tx.client.findFirst({ where: { id: clientId, deletedAt: null }, select: { id: true } });
  if (!client) throw new NotFoundError("That client does not exist.");
}

async function assertProjectOf(tx: DbClient, projectId: string | null, clientId: string): Promise<void> {
  if (!projectId) return;
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { clientId: true } });
  if (!project || project.clientId !== clientId) {
    throw new ValidationError("That project belongs to a different client.", {
      projectId: ["Choose one of this client's projects."],
    });
  }
}

async function assertDomainFree(tx: DbClient, clientId: string, domain: string, exceptId?: string): Promise<void> {
  const clash = await tx.seoProperty.findFirst({
    where: { clientId, domain, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError("This client already has a property for that domain.", {
      website: ["This client already has a property for that domain."],
    });
  }
}

async function countryId(tx: DbClient, code: string | null): Promise<string | null> {
  if (!code) return null;
  const row = await ensureCountry(tx, code);
  if (!row) throw new ValidationError("Choose a country from the list.", { defaultCountry: ["Choose a country from the list."] });
  return row.id;
}

function fieldsFrom(input: SeoPropertyUpdateInput) {
  return {
    domain: input.website.domain,
    // A scheme typed into the address wins over the select; otherwise the select.
    protocol: input.website.protocol ?? input.protocol,
    displayName: input.displayName,
    projectId: input.projectId,
    defaultLanguage: input.defaultLanguage,
    timezone: input.timezone,
    isActive: input.isActive,
    crawlMaxPages: input.crawlMaxPages,
    crawlFrequency: input.crawlFrequency,
    // Manual means the scheduler never starts one; weekly with no date is due now.
    ...(input.crawlFrequency === "MANUAL" ? { nextCrawlAt: null } : {}),
  };
}

export async function createProperty(actor: Actor, input: SeoPropertyCreateInput): Promise<SeoPropertyView> {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);

  const id = await db.$transaction(async (tx) => {
    const clientId = input.owner === INTERNAL_OWNER ? await internalClientId(tx, actor) : input.owner;
    if (input.owner !== INTERNAL_OWNER) await assertClient(tx, clientId);

    const data = fieldsFrom(input);
    await assertProjectOf(tx, data.projectId, clientId);
    await assertDomainFree(tx, clientId, data.domain);

    const created = await tx.seoProperty.create({
      data: {
        ...data,
        clientId,
        defaultCountryId: await countryId(tx, input.defaultCountry),
        createdById: actor.type === "STAFF" ? actor.userId : null,
      },
      select: { id: true, clientId: true, domain: true, displayName: true, protocol: true, projectId: true, isActive: true },
    });
    await record({ actor, action: "CREATE", entityType: "SeoProperty", entityId: created.id, after: created }, tx);
    return created.id;
  });

  return getProperty(actor, id);
}

export async function updateProperty(actor: Actor, id: string, input: SeoPropertyUpdateInput): Promise<SeoPropertyView> {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);

  await db.$transaction(async (tx) => {
    const before = await tx.seoProperty.findFirst({
      where: { id, client: { deletedAt: null } },
      select: { id: true, clientId: true, domain: true, displayName: true, protocol: true, projectId: true, isActive: true, defaultCountryId: true, defaultLanguage: true, timezone: true, crawlMaxPages: true, crawlFrequency: true },
    });
    if (!before) throw new NotFoundError("That SEO property does not exist.");

    const data = fieldsFrom(input);
    await assertProjectOf(tx, data.projectId, before.clientId);
    if (data.domain !== before.domain) await assertDomainFree(tx, before.clientId, data.domain, id);

    const after = await tx.seoProperty.update({
      where: { id },
      data: { ...data, defaultCountryId: await countryId(tx, input.defaultCountry) },
      select: { id: true, clientId: true, domain: true, displayName: true, protocol: true, projectId: true, isActive: true, defaultCountryId: true, defaultLanguage: true, timezone: true, crawlMaxPages: true, crawlFrequency: true },
    });
    await record({ actor, action: "UPDATE", entityType: "SeoProperty", entityId: id, before, after }, tx);
  });

  return getProperty(actor, id);
}

/** What the property form offers: clients, and the open projects per client. */
export async function propertyFormOptions(actor: Actor) {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  const [clients, projects, internal] = await Promise.all([
    db.client.findMany({
      where: { deletedAt: null, isInternal: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 1000,
    }),
    db.project.findMany({
      where: { status: { in: ["PLANNING", "ACTIVE", "ON_HOLD"] }, client: { deletedAt: null } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, clientId: true },
      take: 1000,
    }),
    db.client.findFirst({ where: { isInternal: true, deletedAt: null }, select: { id: true, name: true } }),
  ]);
  return { clients, projects, internal };
}
