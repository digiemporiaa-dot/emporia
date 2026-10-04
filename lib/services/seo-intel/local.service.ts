import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { paged, toSkipTake, type PageParams } from "@/lib/paging";
import { record } from "@/lib/services/audit.service";
import { fromDbDate, toDbDate } from "@/lib/seo-intel/dates";
import { resolvePeriod } from "@/lib/seo-intel/periods";
import { isOnSite, normalizeUrl, siteHosts } from "@/lib/seo-intel/crawler/url";
import {
  ALIASES_CAP,
  cellStatus,
  LOCAL_CITIES_CAP,
  LOCAL_SERVICES_CAP,
  matchCoverage,
  parseTerms,
  TERMS_CAP,
  termsFromServiceName,
  type CellMatch,
  type CellStatus,
} from "@/lib/seo-intel/engine/local";
import type { Actor } from "@/lib/actor/types";

/**
 * Local coverage (Phase 8): the services × cities a website should be found
 * for, which page serves each, and the Search Console demand for each.
 *
 * Staff keep the lists per website. The agency's own website can import its
 * CMS services and Service × City pages; those cells then point at the CMS
 * page's public URL.
 */

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

const userId = (actor: Actor) => (actor.type === "STAFF" ? actor.userId : null);

async function loadProperty(propertyId: string) {
  const property = await db.seoProperty.findFirst({
    where: { id: propertyId, client: { deletedAt: null } },
    select: { id: true, domain: true, protocol: true, client: { select: { isInternal: true } } },
  });
  if (!property) throw new NotFoundError("That website was not found.");
  return property;
}

const originOf = (property: { domain: string; protocol: string }) => `${property.protocol === "HTTP" ? "http" : "https"}://${property.domain}`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export async function localSetup(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const property = await loadProperty(propertyId);
  const [services, cities] = await Promise.all([
    db.seoLocalService.findMany({
      where: { propertyId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, terms: true, cmsServiceId: true, _count: { select: { pages: true } } },
    }),
    db.seoLocalCity.findMany({
      where: { propertyId },
      orderBy: [{ city: { country: "asc" } }, { city: { state: "asc" } }, { city: { name: "asc" } }],
      select: { id: true, cityId: true, aliases: true, city: { select: { name: true, state: true, country: true, countryRef: { select: { name: true } } } } },
    }),
  ]);
  return {
    isInternal: property.client.isInternal,
    services,
    cities: cities.map((row) => ({
      id: row.id,
      cityId: row.cityId,
      aliases: row.aliases,
      name: row.city.name,
      state: row.city.state,
      country: row.city.countryRef?.name ?? row.city.country,
    })),
    caps: { services: LOCAL_SERVICES_CAP, cities: LOCAL_CITIES_CAP, terms: TERMS_CAP, aliases: ALIASES_CAP },
  };
}

/** Cities that can still be added, for the picker. */
export async function availableCities(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  await loadProperty(propertyId);
  return db.city.findMany({
    where: { seoLocalCities: { none: { propertyId } } },
    orderBy: [{ country: "asc" }, { state: "asc" }, { name: "asc" }],
    select: { id: true, name: true, state: true, country: true, isActive: true },
    take: 1_000,
  });
}

export async function saveLocalService(
  actor: Actor,
  propertyId: string,
  input: { id: string | null; name: string; terms: string },
): Promise<{ id: string }> {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  await loadProperty(propertyId);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name || name.length > 100) throw new ValidationError("Enter a service name of up to 100 characters.", { field: "name" });
  const { terms, rejected } = parseTerms(input.terms, TERMS_CAP);
  if (rejected.length) {
    throw new ValidationError(`Up to ${TERMS_CAP} search words, each 2–80 characters. Not accepted: ${rejected.slice(0, 3).join(", ")}.`, { field: "terms" });
  }

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-local:${propertyId}`}))`;
    const clash = await tx.seoLocalService.findFirst({ where: { propertyId, name, ...(input.id ? { id: { not: input.id } } : {}) }, select: { id: true } });
    if (clash) throw new ConflictError("This website already has a service with that name.");
    if (input.id) {
      const before = await tx.seoLocalService.findFirst({ where: { id: input.id, propertyId }, select: { id: true, name: true, terms: true } });
      if (!before) throw new NotFoundError("That service was not found.");
      const after = await tx.seoLocalService.update({ where: { id: before.id }, data: { name, terms }, select: { id: true, name: true, terms: true } });
      await record({ actor, action: "UPDATE", entityType: "SeoLocalService", entityId: before.id, before, after }, tx);
      return { id: before.id };
    }
    const count = await tx.seoLocalService.count({ where: { propertyId } });
    if (count >= LOCAL_SERVICES_CAP) throw new ValidationError(`A website can have up to ${LOCAL_SERVICES_CAP} local services.`);
    const created = await tx.seoLocalService.create({ data: { propertyId, name, terms }, select: { id: true, name: true, terms: true } });
    await record({ actor, action: "CREATE", entityType: "SeoLocalService", entityId: created.id, after: { ...created, propertyId } }, tx);
    return { id: created.id };
  });
}

export async function removeLocalService(actor: Actor, propertyId: string, id: string): Promise<void> {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  await loadProperty(propertyId);
  await db.$transaction(async (tx) => {
    const before = await tx.seoLocalService.findFirst({ where: { id, propertyId }, select: { id: true, name: true, terms: true } });
    if (!before) throw new NotFoundError("That service was not found.");
    await tx.seoLocalService.delete({ where: { id } });
    await record({ actor, action: "DELETE", entityType: "SeoLocalService", entityId: id, before }, tx);
  });
}

export async function addLocalCities(actor: Actor, propertyId: string, cityIds: string[]): Promise<{ added: number }> {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  await loadProperty(propertyId);
  const wanted = [...new Set(cityIds)];
  if (!wanted.length) throw new ValidationError("Choose at least one city.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-local:${propertyId}`}))`;
    const cities = await tx.city.findMany({ where: { id: { in: wanted } }, select: { id: true } });
    if (cities.length !== wanted.length) throw new NotFoundError("One of those cities was not found.");
    const existing = new Set((await tx.seoLocalCity.findMany({ where: { propertyId }, select: { cityId: true } })).map((row) => row.cityId));
    const fresh = wanted.filter((cityId) => !existing.has(cityId));
    if (existing.size + fresh.length > LOCAL_CITIES_CAP) {
      throw new ValidationError(`A website can target up to ${LOCAL_CITIES_CAP} cities; ${Math.max(0, LOCAL_CITIES_CAP - existing.size)} more fit.`);
    }
    if (fresh.length) {
      await tx.seoLocalCity.createMany({ data: fresh.map((cityId) => ({ propertyId, cityId })) });
      await record({ actor, action: "CREATE", entityType: "SeoLocalCity", entityId: propertyId, after: { cityIds: fresh } }, tx);
    }
    return { added: fresh.length };
  });
}

export async function setLocalCityAliases(actor: Actor, propertyId: string, localCityId: string, aliases: string): Promise<void> {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  await loadProperty(propertyId);
  const parsed = parseTerms(aliases, ALIASES_CAP);
  if (parsed.rejected.length) {
    throw new ValidationError(`Up to ${ALIASES_CAP} other names, each 2–80 characters. Not accepted: ${parsed.rejected.slice(0, 3).join(", ")}.`, { field: "aliases" });
  }
  await db.$transaction(async (tx) => {
    const before = await tx.seoLocalCity.findFirst({ where: { id: localCityId, propertyId }, select: { id: true, aliases: true } });
    if (!before) throw new NotFoundError("That city was not found on this website.");
    await tx.seoLocalCity.update({ where: { id: before.id }, data: { aliases: parsed.terms } });
    await record({ actor, action: "UPDATE", entityType: "SeoLocalCity", entityId: before.id, before, after: { id: before.id, aliases: parsed.terms } }, tx);
  });
}

export async function removeLocalCity(actor: Actor, propertyId: string, localCityId: string): Promise<void> {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  await loadProperty(propertyId);
  await db.$transaction(async (tx) => {
    const before = await tx.seoLocalCity.findFirst({ where: { id: localCityId, propertyId }, select: { id: true, cityId: true, aliases: true } });
    if (!before) throw new NotFoundError("That city was not found on this website.");
    // Chosen pages for the city go with it; adding the city back starts clean.
    await tx.seoLocalPage.deleteMany({ where: { propertyId, cityId: before.cityId } });
    await tx.seoLocalCity.delete({ where: { id: before.id } });
    await record({ actor, action: "DELETE", entityType: "SeoLocalCity", entityId: before.id, before }, tx);
  });
}

/** Choose the page for one cell, or clear the choice with a null URL. */
export async function setLocalPage(
  actor: Actor,
  propertyId: string,
  input: { localServiceId: string; cityId: string; url: string | null },
): Promise<void> {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  const property = await loadProperty(propertyId);
  let url: string | null = null;
  if (input.url) {
    url = normalizeUrl(input.url.trim(), `${originOf(property)}/`);
    if (!url || !isOnSite(url, siteHosts(property.domain))) {
      throw new ValidationError(`Enter a page on ${property.domain}.`, { field: "url" });
    }
  }
  await db.$transaction(async (tx) => {
    const [service, city] = await Promise.all([
      tx.seoLocalService.findFirst({ where: { id: input.localServiceId, propertyId }, select: { id: true } }),
      tx.seoLocalCity.findFirst({ where: { propertyId, cityId: input.cityId }, select: { id: true } }),
    ]);
    if (!service || !city) throw new NotFoundError("That service or city is not on this website.");
    const before = await tx.seoLocalPage.findUnique({
      where: { localServiceId_cityId: { localServiceId: service.id, cityId: input.cityId } },
      select: { id: true, url: true },
    });
    if (url) {
      const saved = await tx.seoLocalPage.upsert({
        where: { localServiceId_cityId: { localServiceId: service.id, cityId: input.cityId } },
        create: { propertyId, localServiceId: service.id, cityId: input.cityId, url, updatedById: userId(actor) },
        update: { url, updatedById: userId(actor) },
        select: { id: true, url: true },
      });
      await record({ actor, action: before ? "UPDATE" : "CREATE", entityType: "SeoLocalPage", entityId: saved.id, before, after: saved }, tx);
    } else if (before) {
      await tx.seoLocalPage.delete({ where: { id: before.id } });
      await record({ actor, action: "DELETE", entityType: "SeoLocalPage", entityId: before.id, before }, tx);
    }
  });
}

/**
 * The agency's own website only: add each CMS service (published, or with a
 * Service × City page) and each city that has a Service × City page. Adds
 * what is missing, never removes, and keeps within the caps.
 */
export async function importLocalFromCms(actor: Actor, propertyId: string): Promise<{ services: number; cities: number; skipped: number }> {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  const property = await loadProperty(propertyId);
  if (!property.client.isInternal) throw new ForbiddenError("Only the agency's own website can import from the CMS.");

  const [cmsServices, cmsCities] = await Promise.all([
    db.service.findMany({
      where: { OR: [{ status: "PUBLISHED" }, { cityPages: { some: {} } }] },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    db.city.findMany({ where: { servicePages: { some: {} } }, orderBy: { name: "asc" }, select: { id: true } }),
  ]);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`seo-local:${propertyId}`}))`;
    const existing = await tx.seoLocalService.findMany({ where: { propertyId }, select: { name: true, cmsServiceId: true } });
    const linked = new Set(existing.map((row) => row.cmsServiceId).filter(Boolean));
    const names = new Set(existing.map((row) => row.name));
    let room = LOCAL_SERVICES_CAP - existing.length;
    let skipped = 0;
    const services: { propertyId: string; name: string; terms: string[]; cmsServiceId: string }[] = [];
    for (const service of cmsServices) {
      if (linked.has(service.id) || names.has(service.name)) continue;
      if (room <= 0) {
        skipped += 1;
        continue;
      }
      services.push({ propertyId, name: service.name.slice(0, 100), terms: termsFromServiceName(service.name), cmsServiceId: service.id });
      names.add(service.name);
      room -= 1;
    }
    const haveCities = new Set((await tx.seoLocalCity.findMany({ where: { propertyId }, select: { cityId: true } })).map((row) => row.cityId));
    let cityRoom = LOCAL_CITIES_CAP - haveCities.size;
    const cities: string[] = [];
    for (const city of cmsCities) {
      if (haveCities.has(city.id)) continue;
      if (cityRoom <= 0) {
        skipped += 1;
        continue;
      }
      cities.push(city.id);
      cityRoom -= 1;
    }
    if (services.length) await tx.seoLocalService.createMany({ data: services });
    if (cities.length) await tx.seoLocalCity.createMany({ data: cities.map((cityId) => ({ propertyId, cityId })) });
    if (services.length || cities.length) {
      await record({ actor, action: "CREATE", entityType: "SeoLocalService", entityId: propertyId, after: { importedFromCms: true, services: services.map((s) => s.name), cityIds: cities } }, tx);
    }
    return { services: services.length, cities: cities.length, skipped };
  });
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

type SumRow = { key: string; clicks: bigint | number | null; impressions: bigint | number | null; weighted: number | null };

export type CoverageCell = CellMatch & {
  status: CellStatus;
  crawled: { statusCode: number | null; indexable: boolean | null } | null;
  performance: { clicks: number; impressions: number; position: number | null } | null;
  cms: { id: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED" } | null;
};

/**
 * Every cell for a website, from its lists, the latest finished crawl and the
 * last 28 days of Search Console. No actor: callers scope the website.
 */
export async function computeCoverage(propertyId: string) {
  const property = await loadProperty(propertyId);
  const [services, cities, chosen, run, latest] = await Promise.all([
    db.seoLocalService.findMany({ where: { propertyId }, orderBy: { name: "asc" }, select: { id: true, name: true, terms: true, cmsServiceId: true } }),
    db.seoLocalCity.findMany({
      where: { propertyId },
      select: { cityId: true, aliases: true, city: { select: { name: true, slug: true, state: true, country: true, countryRef: { select: { name: true } } } } },
    }),
    db.seoLocalPage.findMany({ where: { propertyId }, select: { localServiceId: true, cityId: true, url: true } }),
    db.crawlRun.findFirst({ where: { propertyId, status: "SUCCEEDED" }, orderBy: { startedAt: "desc" }, select: { id: true, finishedAt: true } }),
    db.gscDailyTotal.aggregate({ where: { propertyId, device: "", country: "" }, _max: { date: true } }),
  ]);
  const range = latest._max.date ? resolvePeriod("28d", fromDbDate(latest._max.date)).current : null;

  const [pages, queryRows] = await Promise.all([
    run
      ? db.crawlPage.findMany({
          where: { runId: run.id, state: "FETCHED" },
          select: { url: true, title: true, h1: true, statusCode: true, indexable: true, inlinks: true },
        })
      : Promise.resolve([]),
    range && services.length && cities.length
      ? db.$queryRaw<SumRow[]>(Prisma.sql`
          SELECT query AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, 0::float AS weighted
          FROM "GscQueryDaily"
          WHERE "propertyId" = ${propertyId} AND date BETWEEN ${toDbDate(range.start)}::date AND ${toDbDate(range.end)}::date
          GROUP BY query ORDER BY SUM(impressions) DESC LIMIT 20000`)
      : Promise.resolve([] as SumRow[]),
  ]);

  // The agency's own CMS pages, where services were imported from it.
  const cmsPages = new Map<string, { id: string; status: "DRAFT" | "PUBLISHED" | "ARCHIVED"; url: string }>();
  const cmsServiceIds = services.map((s) => s.cmsServiceId).filter((id): id is string => !!id);
  if (property.client.isInternal && cmsServiceIds.length && cities.length) {
    const rows = await db.serviceCityPage.findMany({
      where: { serviceId: { in: cmsServiceIds }, cityId: { in: cities.map((c) => c.cityId) } },
      select: { id: true, status: true, serviceId: true, cityId: true, service: { select: { slug: true } }, city: { select: { slug: true } } },
    });
    const byCms = new Map(services.filter((s) => s.cmsServiceId).map((s) => [s.cmsServiceId as string, s.id]));
    for (const row of rows) {
      const localId = byCms.get(row.serviceId);
      if (!localId) continue;
      const url = normalizeUrl(`${originOf(property)}/services/${row.service.slug}/${row.city.slug}`);
      if (url) cmsPages.set(`${localId}:${row.cityId}`, { id: row.id, status: row.status, url });
    }
  }

  const cells = matchCoverage({
    services: services.map((s) => ({ id: s.id, name: s.name, terms: s.terms })),
    cities: cities.map((c) => ({ id: c.cityId, name: c.city.name, slug: c.city.slug, aliases: c.aliases })),
    pages,
    queries: queryRows.map((row) => ({ query: row.key, clicks: Number(row.clicks ?? 0), impressions: Number(row.impressions ?? 0) })),
    chosen: new Map(chosen.map((row) => [`${row.localServiceId}:${row.cityId}`, row.url])),
    cms: new Map([...cmsPages].filter(([, page]) => page.status === "PUBLISHED").map(([key, page]) => [key, page.url])),
  });

  // Search Console figures for the matched pages.
  const matchedUrls = [...new Set(cells.map((cell) => cell.page?.url).filter((url): url is string => !!url))];
  const performance = new Map<string, { clicks: number; impressions: number; weighted: number }>();
  if (range && matchedUrls.length) {
    const rows = await db.$queryRaw<SumRow[]>(Prisma.sql`
      SELECT page AS key, SUM(clicks) AS clicks, SUM(impressions) AS impressions, SUM(position * impressions) AS weighted
      FROM "GscPageDaily"
      WHERE "propertyId" = ${propertyId} AND date BETWEEN ${toDbDate(range.start)}::date AND ${toDbDate(range.end)}::date
      GROUP BY page`);
    const wanted = new Set(matchedUrls);
    for (const row of rows) {
      const url = normalizeUrl(row.key);
      if (!url || !wanted.has(url)) continue;
      const sum = performance.get(url) ?? { clicks: 0, impressions: 0, weighted: 0 };
      sum.clicks += Number(row.clicks ?? 0);
      sum.impressions += Number(row.impressions ?? 0);
      sum.weighted += Number(row.weighted ?? 0);
      performance.set(url, sum);
    }
  }

  const crawledByUrl = new Map(pages.map((page) => [page.url, page]));
  const enriched: CoverageCell[] = cells.map((cell) => {
    const cms = cmsPages.get(`${cell.serviceId}:${cell.cityId}`) ?? null;
    const crawledPage = cell.page ? crawledByUrl.get(cell.page.url) : undefined;
    const crawled = crawledPage ? { statusCode: crawledPage.statusCode, indexable: crawledPage.indexable } : null;
    const perf = cell.page ? performance.get(cell.page.url) : undefined;
    return {
      ...cell,
      status: cellStatus({ page: cell.page, crawled, cmsStatus: cms?.status ?? null }),
      crawled,
      performance: perf ? { clicks: perf.clicks, impressions: perf.impressions, position: perf.impressions > 0 ? perf.weighted / perf.impressions : null } : null,
      cms: cms ? { id: cms.id, status: cms.status } : null,
    };
  });

  return {
    isInternal: property.client.isInternal,
    run,
    range,
    services: services.map((s) => ({ id: s.id, name: s.name })),
    cities: cities.map((c) => ({
      cityId: c.cityId,
      name: c.city.name,
      state: c.city.state,
      country: c.city.countryRef?.name ?? c.city.country,
    })),
    cells: enriched,
  };
}

export const CELL_STATUSES = ["gap", "not-indexable", "not-crawled", "draft", "covered"] as const;

/** The coverage matrix for the screen: cities paged, grouped by country and state. */
export async function localCoverage(
  actor: Actor,
  propertyId: string,
  params: Partial<PageParams> & { status?: CellStatus | null; cell?: string | null } = {},
) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const coverage = await computeCoverage(propertyId);
  const { page, perPage, skip, take } = toSkipTake(params);

  const counts = Object.fromEntries(CELL_STATUSES.map((status) => [status, 0])) as Record<CellStatus, number>;
  let gapDemand = 0;
  for (const cell of coverage.cells) {
    counts[cell.status] += 1;
    if (cell.status === "gap") gapDemand += cell.demand.impressions;
  }

  const cellsByCity = new Map<string, CoverageCell[]>();
  for (const cell of coverage.cells) {
    const list = cellsByCity.get(cell.cityId) ?? [];
    list.push(cell);
    cellsByCity.set(cell.cityId, list);
  }
  const cities = [...coverage.cities]
    .sort((a, b) => a.country.localeCompare(b.country) || a.state.localeCompare(b.state) || a.name.localeCompare(b.name))
    .map((city) => ({ ...city, cells: cellsByCity.get(city.cityId) ?? [] }))
    .filter((city) => !params.status || city.cells.some((cell) => cell.status === params.status));

  const selected = params.cell ? coverage.cells.find((cell) => `${cell.serviceId}:${cell.cityId}` === params.cell) ?? null : null;

  return {
    isInternal: coverage.isInternal,
    run: coverage.run,
    range: coverage.range,
    services: coverage.services,
    selected: selected
      ? { ...selected, serviceName: coverage.services.find((s) => s.id === selected.serviceId)?.name ?? "", cityName: coverage.cities.find((c) => c.cityId === selected.cityId)?.name ?? "" }
      : null,
    counts,
    gapDemand,
    total: coverage.cells.length,
    list: paged(cities.slice(skip, skip + take), cities.length, page, perPage),
  };
}
