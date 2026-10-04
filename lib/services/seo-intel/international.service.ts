import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { countryName } from "@/lib/geo/countries";
import { alpha2FromAlpha3 } from "@/lib/geo/iso";
import { fromDbDate, toDbDate } from "@/lib/seo-intel/dates";
import { resolvePeriod, type DayRange } from "@/lib/seo-intel/periods";
import {
  countriesWithoutVersion,
  countriesWithVersion,
  declaredVersions,
  localeSegment,
  primaryLanguage,
  type CountryTraffic,
} from "@/lib/seo-intel/engine/international";
import { RULES, type RuleKey } from "@/lib/seo-intel/engine/technical";
import { thresholdsFor } from "@/lib/services/seo-intel/thresholds.service";
import type { Actor } from "@/lib/actor/types";

/**
 * International SEO (Phase 8): the language and country versions a website
 * declares, what is wrong with them, and which countries send traffic
 * without having a version. Built on the latest finished crawl and the
 * stored Search Console country totals.
 */

export const INTERNATIONAL_RULES: RuleKey[] = [
  "hreflang-invalid",
  "hreflang-no-return",
  "hreflang-duplicate-code",
  "hreflang-to-broken",
  "hreflang-canonical-conflict",
  "hreflang-no-self",
  "hreflang-lang-mismatch",
  "country-duplicate",
  "lang-missing",
];

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

type Row = { country: string; clicks: bigint | number | null; impressions: bigint | number | null };

async function countryTraffic(propertyId: string, range: DayRange): Promise<CountryTraffic[]> {
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT country, SUM(clicks) AS clicks, SUM(impressions) AS impressions
    FROM "GscDailyTotal"
    WHERE "propertyId" = ${propertyId} AND device = '' AND country <> ''
      AND date BETWEEN ${toDbDate(range.start)}::date AND ${toDbDate(range.end)}::date
    GROUP BY country`);
  const byCode = new Map<string, CountryTraffic>();
  for (const row of rows) {
    // Google's "zzz" (unknown) and anything unmapped are left out, not guessed.
    const code = alpha2FromAlpha3(row.country);
    if (!code) continue;
    const sum = byCode.get(code) ?? { country: code, clicks: 0, impressions: 0 };
    sum.clicks += Number(row.clicks ?? 0);
    sum.impressions += Number(row.impressions ?? 0);
    byCode.set(code, sum);
  }
  return [...byCode.values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

/** The analysis, without an actor: callers scope the website. */
export async function computeInternational(propertyId: string) {
  const property = await db.seoProperty.findFirst({
    where: { id: propertyId, client: { deletedAt: null } },
    select: { id: true, defaultCountry: { select: { code: true } } },
  });
  if (!property) throw new NotFoundError("That website was not found.");
  const [run, latest, t] = await Promise.all([
    db.crawlRun.findFirst({ where: { propertyId, status: "SUCCEEDED" }, orderBy: { startedAt: "desc" }, select: { id: true, finishedAt: true } }),
    db.gscDailyTotal.aggregate({ where: { propertyId, device: "", country: "" }, _max: { date: true } }),
    thresholdsFor(propertyId),
  ]);

  const pages = run
    ? (
        await db.crawlPage.findMany({
          where: { runId: run.id, state: "FETCHED", statusCode: 200 },
          select: { url: true, lang: true, hreflang: true, indexable: true },
        })
      ).map((page) => ({
        url: page.url,
        lang: page.lang,
        indexable: page.indexable,
        hreflang: Array.isArray(page.hreflang) ? (page.hreflang as { lang: string; href: string }[]) : [],
      }))
    : [];

  const versions = declaredVersions(pages);
  const segments = new Map<string, number>();
  const languages = new Map<string, number>();
  for (const page of pages) {
    const { segment } = localeSegment(page.url);
    if (segment) segments.set(segment, (segments.get(segment) ?? 0) + 1);
    const language = primaryLanguage(page.lang);
    languages.set(language ?? "", (languages.get(language ?? "") ?? 0) + 1);
  }
  // Several versions: two or more hreflang codes, or locale paths seen on
  // more than one page each (one stray "/my/" page is not a version).
  const multiVersion = versions.size >= 2 || [...segments.values()].filter((count) => count >= 2).length >= 2;
  const withVersion = countriesWithVersion(pages, property.defaultCountry?.code ?? null);

  const period = latest._max.date ? resolvePeriod("28d", fromDbDate(latest._max.date)) : null;
  const [current, previous] = period ? await Promise.all([countryTraffic(propertyId, period.current), countryTraffic(propertyId, period.previous)]) : [[], []];
  const missing = countriesWithoutVersion(current, withVersion, multiVersion, { minShare: t["intl.minShare"], minClicks: t["intl.minClicks"] });

  return { run, period, pages: pages.length, versions, segments, languages, multiVersion, withVersion, current, previous, missing };
}

export async function internationalOverview(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const analysis = await computeInternational(propertyId);

  const issues = analysis.run
    ? await db.crawlIssue.groupBy({ by: ["rule"], where: { runId: analysis.run.id, rule: { in: INTERNATIONAL_RULES } }, _count: { _all: true } })
    : [];
  const issueCount = new Map(issues.map((row) => [row.rule, row._count._all]));
  const previousByCode = new Map(analysis.previous.map((row) => [row.country, row]));
  const total = analysis.current.reduce((sum, row) => sum + row.clicks, 0);
  const missing = new Set(analysis.missing.map((row) => row.country));

  return {
    run: analysis.run,
    period: analysis.period,
    pages: analysis.pages,
    multiVersion: analysis.multiVersion,
    versions: [...analysis.versions].sort((a, b) => b[1] - a[1]).map(([code, pages]) => ({ code, pages })),
    segments: [...analysis.segments].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([segment, pages]) => ({ segment, pages })),
    languages: [...analysis.languages].sort((a, b) => b[1] - a[1]).map(([language, pages]) => ({ language: language || null, pages })),
    issues: INTERNATIONAL_RULES.map((rule) => ({ rule, title: RULES[rule].title, why: RULES[rule].why, severity: RULES[rule].severity, count: issueCount.get(rule) ?? 0 })),
    countries: analysis.current.slice(0, 50).map((row) => ({
      ...row,
      name: countryName(row.country) ?? row.country,
      share: total > 0 ? row.clicks / total : 0,
      previousClicks: previousByCode.get(row.country)?.clicks ?? 0,
      hasVersion: analysis.withVersion.has(row.country),
      missing: missing.has(row.country),
    })),
  };
}
