import type { Metadata } from "next";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listLibrary } from "@/lib/services/social-occasion.service";
import { CALENDAR_TIME_ZONE, zonedDay } from "@/lib/social/calendar";
import { OccasionLibrary } from "./occasion-library";

export const metadata: Metadata = { title: "Occasion library" };
export const dynamic = "force-dynamic";

export default async function OccasionLibraryPage() {
  const actor = await requireActorPage("/admin/social/occasions");
  const occasions = await listLibrary(actor);
  const year = zonedDay(new Date(), CALENDAR_TIME_ZONE).year;

  return (
    <OccasionLibrary
      year={year}
      canManage={can(actor, "social.occasions.manage")}
      occasions={occasions.map((o) => ({
        id: o.id,
        clientId: o.clientId,
        name: o.name,
        category: o.category,
        description: o.description,
        fixedMonth: o.fixedMonth,
        fixedDay: o.fixedDay,
        archived: o.archivedAt !== null,
        dates: o.dates.map((d) => ({ id: d.id, day: d.date.toISOString().slice(0, 10) })),
      }))}
    />
  );
}
