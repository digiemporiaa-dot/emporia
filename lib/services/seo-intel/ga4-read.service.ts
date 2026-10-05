import "server-only";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { toDbDate } from "@/lib/seo-intel/dates";
import { pathKey } from "@/lib/seo-intel/engine/organic";
import { Decimal, toMoneyString, ZERO } from "@/lib/money";

/**
 * Reading stored GA4 rows (Phase 9). No actor: callers have already decided
 * who may see what. Kept apart from the organic service so the general
 * analytics service can read sessions without importing SEO screens' code.
 */

/** The agency's own website, when its GA4 is connected. */
export async function agencyGa4Property(): Promise<{ id: string; currency: string | null } | null> {
  const property = await db.seoProperty.findFirst({
    where: {
      isActive: true,
      ga4PropertyId: { not: null },
      client: { isInternal: true, deletedAt: null },
      connections: { some: { source: "ANALYTICS", status: { in: ["CONNECTED", "ERROR"] } } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, ga4Currency: true },
  });
  return property ? { id: property.id, currency: property.ga4Currency } : null;
}

type Row = { page: string; sessions: bigint | number | null; keyEvents: number | null; revenue: { toString(): string } | null };

export type PathStats = { sessions: number; keyEvents: number; revenue: string };

/**
 * Landing-page sessions, key events and revenue by `pathKey`, between two
 * days inclusive (start null: from the beginning), all channels or one.
 */
export async function landingStatsByPath(propertyId: string, range: { start: string | null; end: string }, channel?: string): Promise<Map<string, PathStats>> {
  const rows = await db.$queryRaw<Row[]>(Prisma.sql`
    SELECT "landingPage" AS page, SUM(sessions) AS sessions, SUM("keyEvents") AS "keyEvents", SUM(revenue) AS revenue
    FROM "Ga4LandingDaily"
    WHERE "propertyId" = ${propertyId}
      AND date <= ${toDbDate(range.end)}::date
      ${range.start ? Prisma.sql`AND date >= ${toDbDate(range.start)}::date` : Prisma.empty}
      ${channel ? Prisma.sql`AND channel = ${channel}` : Prisma.empty}
    GROUP BY "landingPage"`);
  const out = new Map<string, { sessions: number; keyEvents: number; revenue: Decimal }>();
  for (const row of rows) {
    if (row.page === "(not set)") continue;
    const key = pathKey(row.page);
    const entry = out.get(key) ?? { sessions: 0, keyEvents: 0, revenue: ZERO };
    entry.sessions += Number(row.sessions ?? 0);
    entry.keyEvents += Number(row.keyEvents ?? 0);
    entry.revenue = entry.revenue.plus(new Decimal(row.revenue?.toString() ?? "0"));
    out.set(key, entry);
  }
  return new Map([...out].map(([key, value]) => [key, { sessions: value.sessions, keyEvents: value.keyEvents, revenue: toMoneyString(value.revenue) }]));
}

/** A local-time Date as a day string, the way the analytics ranges count days. */
export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
