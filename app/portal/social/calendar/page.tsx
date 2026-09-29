import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { portalSocialCalendar } from "@/lib/services/portal-social.service";
import { CALENDAR_TIME_ZONE, zonedDay, ymdKey } from "@/lib/social/calendar";
import { monthLabel } from "@/lib/social/report-doc";
import { Card, CardBody } from "@/components/ui";
import { PortalPostCard } from "@/components/portal/social-post-card";

export const metadata: Metadata = { title: "Social calendar" };
export const dynamic = "force-dynamic";

/**
 * The client's month, day by day: posts waiting for them, approved,
 * scheduled and published. Ideas and internal drafts are not shown.
 */

const params = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).nullable().catch(null).default(null) });
const DAY = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

export default async function PortalSocialCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePortalActorPage();
  const today = zonedDay(new Date(), CALENDAR_TIME_ZONE);
  const month = params.parse(await searchParams).month ?? `${today.year}-${String(today.month).padStart(2, "0")}`;
  const [year, m] = month.split("-").map(Number) as [number, number];
  const cards = await portalSocialCalendar(actor, { year, month: m });

  const days = new Map<string, typeof cards>();
  for (const card of cards) {
    const key = ymdKey(zonedDay(new Date(card.at!), CALENDAR_TIME_ZONE));
    days.set(key, [...(days.get(key) ?? []), card]);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/portal/social/calendar?month=${shift(month, -1)}` as Route} className="text-xs text-navy-800 underline underline-offset-4">
          ← {monthLabel(shift(month, -1))}
        </Link>
        <h2 className="text-base font-medium text-navy-800">{monthLabel(month)}</h2>
        <Link href={`/portal/social/calendar?month=${shift(month, 1)}` as Route} className="text-xs text-navy-800 underline underline-offset-4">
          {monthLabel(shift(month, 1))} →
        </Link>
      </div>
      <p className="text-2xs text-ink-subtle">Times are India time.</p>

      {days.size === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">Nothing planned for this month yet.</p>
          </CardBody>
        </Card>
      ) : (
        <ol className="space-y-4">
          {[...days.entries()].map(([day, list]) => (
            <li key={day} className="grid gap-2 md:grid-cols-[8rem_minmax(0,1fr)]">
              <p className="text-sm font-medium text-navy-800">{DAY.format(new Date(`${day}T00:00:00Z`))}</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {list.map((post) => (
                  <li key={post.id} className="min-w-0">
                    <PortalPostCard post={post} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
