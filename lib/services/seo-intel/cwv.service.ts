import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ConflictError, ForbiddenError, IntegrationNotConfiguredError, isAppError, NotFoundError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { record } from "@/lib/services/audit.service";
import { addDays, fromDbDate, toDbDate } from "@/lib/seo-intel/dates";
import { cruxApiKey } from "@/lib/seo-intel/google/settings";
import { siteHosts } from "@/lib/seo-intel/crawler/url";
import { cruxOrigins, cwvVerdict } from "@/lib/seo-intel/engine/cwv";
import { ChromeUxReport, type CruxFormFactor, type CruxProvider, type CruxRecord } from "@/lib/seo-intel/providers/crux";
import type { Actor } from "@/lib/actor/types";

/**
 * Core Web Vitals (Phase 11), from the Chrome UX Report.
 *
 * Weekly per website: the origin on phones and desktops, and the twenty pages
 * with the most Search Console clicks over the last 28 days on phones. The
 * first check also fills the origin's history (up to 25 weekly periods), so
 * the trend is there from day one. Nothing runs without an API key; the
 * screen then says so instead of showing anything.
 */

const cwvLog = log("seo-cwv");
export const CWV_INTERVAL_DAYS = 7;
export const CWV_TOP_PAGES = 20;
const FORM_FACTORS: readonly CruxFormFactor[] = ["PHONE", "DESKTOP"];

function staffOnly(actor: Actor) {
  if (actor.type !== "STAFF" && actor.type !== "SYSTEM") throw new ForbiddenError("Not available in the client portal.");
}

/** The provider for the stored key, or null when none is set up (or it no longer decrypts). */
export async function cruxProvider(): Promise<CruxProvider | null> {
  const key = await cruxApiKey();
  return key ? new ChromeUxReport(key) : null;
}

const row = (propertyId: string, url: string, formFactor: string, rec: CruxRecord, now: Date) => ({
  propertyId,
  url,
  formFactor,
  periodEnd: toDbDate(rec.periodEnd),
  lcp: rec.lcp,
  inp: rec.inp,
  cls: rec.cls,
  fcp: rec.fcp,
  ttfb: rec.ttfb,
  fetchedAt: now,
});

async function store(rows: ReturnType<typeof row>[]) {
  for (const data of rows) {
    const { propertyId, url, formFactor, periodEnd, ...figures } = data;
    await db.cwvSnapshot.upsert({
      where: { propertyId_url_formFactor_periodEnd: { propertyId, url, formFactor, periodEnd } },
      create: data,
      update: figures,
    });
  }
}

/** The pages with the most clicks in the 28 days to Search Console's latest day, on this site only. */
async function topPages(propertyId: string, domain: string): Promise<string[]> {
  const latest = await db.gscPageDaily.aggregate({ where: { propertyId }, _max: { date: true } });
  if (!latest._max.date) return [];
  const end = fromDbDate(latest._max.date);
  const rows = await db.$queryRaw<{ page: string }[]>(Prisma.sql`
    SELECT page FROM "GscPageDaily"
    WHERE "propertyId" = ${propertyId} AND date BETWEEN ${toDbDate(addDays(end, -27))}::date AND ${latest._max.date}::date
    GROUP BY page ORDER BY SUM(clicks) DESC, page ASC LIMIT ${CWV_TOP_PAGES * 2}`);
  const hosts = siteHosts(domain);
  const pages: string[] = [];
  for (const { page } of rows) {
    try {
      const url = new URL(page);
      if (!hosts.has(url.hostname.toLowerCase()) || url.port) continue;
      url.hash = "";
      if (!pages.includes(url.toString())) pages.push(url.toString());
    } catch {
      continue;
    }
    if (pages.length === CWV_TOP_PAGES) break;
  }
  return pages;
}

export type CwvCheckOutcome = { origin: boolean; pages: number; pagesWithData: number };

/** Read one website's Core Web Vitals now. `provider` is a seam for tests. */
export async function checkCwv(propertyId: string, options: { provider?: CruxProvider; now?: Date } = {}): Promise<CwvCheckOutcome> {
  const now = options.now ?? new Date();
  const property = await db.seoProperty.findFirst({
    where: { id: propertyId, client: { deletedAt: null } },
    select: { id: true, domain: true, protocol: true, _count: { select: { cwvSnapshots: true } } },
  });
  if (!property) throw new NotFoundError("That website was not found.");
  const provider = options.provider ?? (await cruxProvider());
  if (!provider) throw new IntegrationNotConfiguredError("Core Web Vitals need a Chrome UX Report API key. Add it in SEO settings.");

  try {
    const rows: ReturnType<typeof row>[] = [];
    const history: ReturnType<typeof row>[] = [];
    // The origin: whichever www variant Google has data for.
    let origin: string | null = null;
    for (const candidate of cruxOrigins(property.domain, property.protocol)) {
      const phone = await provider.record({ origin: candidate }, "PHONE");
      const desktop = await provider.record({ origin: candidate }, "DESKTOP");
      if (!phone && !desktop) continue;
      origin = candidate;
      if (phone) rows.push(row(property.id, "", "PHONE", phone, now));
      if (desktop) rows.push(row(property.id, "", "DESKTOP", desktop, now));
      break;
    }
    if (origin && property._count.cwvSnapshots === 0) {
      for (const formFactor of FORM_FACTORS) {
        for (const rec of await provider.history({ origin }, formFactor)) history.push(row(property.id, "", formFactor, rec, now));
      }
    }

    const pages = await topPages(property.id, property.domain);
    let pagesWithData = 0;
    for (const url of pages) {
      const rec = await provider.record({ url }, "PHONE");
      if (!rec) continue;
      pagesWithData++;
      rows.push(row(property.id, url, "PHONE", rec, now));
    }

    // History first, so the latest record wins any shared period.
    await store([...history, ...rows]);
    await db.seoProperty.update({ where: { id: property.id }, data: { cwvCheckedAt: now, cwvError: null } });
    return { origin: origin !== null, pages: pages.length, pagesWithData };
  } catch (error) {
    // Checked, and failed: wait for the next week, and say why on the screen.
    const message = isAppError(error) ? error.publicMessage : "The Core Web Vitals check failed. The next one will try again.";
    await db.seoProperty.update({ where: { id: property.id }, data: { cwvCheckedAt: now, cwvError: message.slice(0, 500) } });
    throw error;
  }
}

/** The scheduler's weekly check: a few websites per run, each claimed so two runs never check one together. */
export async function checkDueCwv(options: { limit?: number; now?: Date; provider?: CruxProvider } = {}): Promise<{ checked: number; failed: number }> {
  const now = options.now ?? new Date();
  const provider = options.provider ?? (await cruxProvider());
  if (!provider) return { checked: 0, failed: 0 };
  const due = new Date(now.getTime() - CWV_INTERVAL_DAYS * 86_400_000);
  const candidates = await db.seoProperty.findMany({
    where: { isActive: true, client: { deletedAt: null }, OR: [{ cwvCheckedAt: null }, { cwvCheckedAt: { lte: due } }] },
    orderBy: [{ cwvCheckedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: options.limit ?? 2,
    select: { id: true, cwvCheckedAt: true },
  });
  let checked = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const claim = await db.seoProperty.updateMany({ where: { id: candidate.id, cwvCheckedAt: candidate.cwvCheckedAt }, data: { cwvCheckedAt: now } });
    if (claim.count === 0) continue;
    try {
      await checkCwv(candidate.id, { provider, now });
      checked++;
    } catch (error) {
      failed++;
      cwvLog.warn({ err: error, propertyId: candidate.id }, "core web vitals check failed");
    }
  }
  return { checked, failed };
}

/** "Check now" from the screen. Not more than once an hour per website — CrUX changes daily at most. */
export async function checkCwvNow(actor: Actor, propertyId: string, options: { provider?: CruxProvider; now?: Date } = {}) {
  requirePermission(actor, "seo.intelligence.manage");
  staffOnly(actor);
  const now = options.now ?? new Date();
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true, cwvCheckedAt: true } });
  if (!property) throw new NotFoundError("That website was not found.");
  if (property.cwvCheckedAt && now.getTime() - property.cwvCheckedAt.getTime() < 3_600_000) {
    throw new ConflictError("Core Web Vitals were checked within the last hour. Google updates them once a day.");
  }
  const outcome = await checkCwv(propertyId, { ...options, now });
  await record({ actor, action: "UPDATE", entityType: "SeoProperty", entityId: propertyId, after: { cwvChecked: true, ...outcome } });
  return outcome;
}

type Snapshot = { url: string; formFactor: string; periodEnd: Date; lcp: number | null; inp: number | null; cls: number | null; fcp: number | null; ttfb: number | null };
const view = (s: Snapshot) => ({ periodEnd: fromDbDate(s.periodEnd), lcp: s.lcp, inp: s.inp, cls: s.cls, fcp: s.fcp, ttfb: s.ttfb, verdict: cwvVerdict(s) });

/** Everything the Page speed screen shows. */
export async function cwvOverview(actor: Actor, propertyId: string) {
  requirePermission(actor, "seo.intelligence.view");
  staffOnly(actor);
  const property = await db.seoProperty.findFirst({ where: { id: propertyId, client: { deletedAt: null } }, select: { id: true, cwvCheckedAt: true, cwvError: true } });
  if (!property) throw new NotFoundError("That website was not found.");
  const configured = (await cruxApiKey()) !== null;

  const [origin, latestPages] = await Promise.all([
    db.cwvSnapshot.findMany({ where: { propertyId, url: "" }, orderBy: { periodEnd: "asc" } }),
    db.cwvSnapshot.findMany({
      where: { propertyId, url: { not: "" }, formFactor: "PHONE" },
      orderBy: [{ url: "asc" }, { periodEnd: "desc" }],
      distinct: ["url"],
    }),
  ]);
  const latestOf = (formFactor: string) => {
    const rows = origin.filter((s) => s.formFactor === formFactor);
    return rows.length ? view(rows[rows.length - 1] as Snapshot) : null;
  };
  // Only the pages the latest check read: a page that has left the top twenty keeps its rows, but is not listed.
  const lastFetch = Math.max(0, ...latestPages.map((s) => s.fetchedAt.getTime()));
  const current = latestPages.filter((s) => s.fetchedAt.getTime() === lastFetch);
  return {
    configured,
    checkedAt: property.cwvCheckedAt,
    error: property.cwvError,
    phone: latestOf("PHONE"),
    desktop: latestOf("DESKTOP"),
    trend: origin.filter((s) => s.formFactor === "PHONE").slice(-26).map(view),
    pages: current.map((s) => ({ url: s.url, ...view(s) })).sort((a, b) => rank(a.verdict) - rank(b.verdict) || (b.lcp ?? 0) - (a.lcp ?? 0)),
  };
}

const rank = (verdict: string | null) => (verdict === "poor" ? 0 : verdict === "needs-improvement" ? 1 : verdict === "good" ? 2 : 3);
