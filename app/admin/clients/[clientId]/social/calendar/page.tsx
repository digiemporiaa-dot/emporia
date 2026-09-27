import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { requireActorPage } from "@/lib/actor";
import {
  calendarPosts,
  unscheduledPosts,
  type CalendarCard as Card,
} from "@/lib/services/social-calendar.service";
import { contentFormOptions } from "@/lib/services/social-content.service";
import { socialCalendarParamsSchema } from "@/lib/validation/social";
import {
  buildGrid,
  CALENDAR_TIME_ZONE,
  parseAnchor,
  zoneLabel,
} from "@/lib/social/calendar";
import { CAPABILITIES } from "@/lib/social/capabilities";
import { CalendarBody } from "./calendar-grid";
import { CalendarToolbar, type ToolbarOptions } from "./calendar-toolbar";
import { CalendarCard } from "./calendar-card";
import type { SocialPostType, SocialProvider } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Social calendar" };
export const dynamic = "force-dynamic";

/**
 * What is going out, and when.
 *
 * The calendar is over platform **versions** rather than ideas: one idea with
 * an Instagram reel at 7:30pm and a LinkedIn post the next morning is two
 * cards on two days, because those are two things a person has to have ready
 * at two different times.
 *
 * The grid is rendered on the server in one declared timezone — see
 * `lib/social/calendar.ts` for why that beats the reader's own — and the zone
 * is printed above it so nobody has to work it out.
 */
export default async function SocialCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { clientId } = await params;
  const raw = await searchParams;
  const actor = await requireActorPage(`/admin/clients/${clientId}/social/calendar`);

  const state = socialCalendarParamsSchema.parse(raw);
  const anchor = parseAnchor(state.date, CALENDAR_TIME_ZONE);
  const grid = buildGrid(state.view, anchor, CALENDAR_TIME_ZONE);

  // One set of filters, applied to the grid and to the undated panel alike.
  const filters = {
    clientId,
    provider: state.provider,
    type: state.type,
    status: state.status,
    stage: state.stage,
    campaignId: state.campaignId,
    projectId: state.projectId,
    ownerId: state.ownerId,
  };

  const [{ cards, truncated }, unscheduled, options] = await Promise.all([
    calendarPosts(actor, { ...filters, from: grid.range.from, to: grid.range.to }),
    unscheduledPosts(actor, filters),
    contentFormOptions(actor, clientId),
  ]);

  const base = `/admin/clients/${clientId}/social`;
  const toolbarOptions: ToolbarOptions = {
    // Only platforms this client actually has an account on — a filter for a
    // platform they have never connected is a dead option.
    providers: uniqueProviders(options.accounts.map((account) => account.provider)),
    types: uniqueTypes(options.accounts.map((account) => account.provider)),
    campaigns: options.campaigns,
    projects: options.projects,
    staff: options.staff,
  };

  const timeFormat = new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: CALENDAR_TIME_ZONE,
  });

  return (
    <div className="space-y-4">
      <CalendarToolbar
        base={`${base}/calendar`}
        state={state}
        options={toolbarOptions}
        title={grid.title}
        previous={grid.previous}
        next={grid.next}
        today={grid.today}
        zone={zoneLabel(CALENDAR_TIME_ZONE)}
        count={cards.length}
      />

      {truncated ? (
        <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-ink-muted">
          This period has more posts than the calendar shows at once. Narrow it with a filter, or
          switch to the week view.
        </p>
      ) : null}

      <CalendarBody grid={grid} cards={cards} base={base} timeZone={CALENDAR_TIME_ZONE} />

      {unscheduled.length > 0 ? (
        <section aria-labelledby="unscheduled" className="rounded-lg border border-line bg-white p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="unscheduled" className="text-sm font-medium text-navy-800">
              Written, not scheduled
            </h2>
            <p className="text-2xs text-ink-subtle">
              {unscheduled.length} version{unscheduled.length === 1 ? "" : "s"} with no date
            </p>
          </div>
          <ul className="mt-2.5 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {unscheduled.map((card: Card) => (
              <li key={card.id}>
                <CalendarCard card={card} density="full" base={base} timeFormat={timeFormat} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {options.accounts.length === 0 ? (
        <p className="text-xs text-ink-subtle">
          No social accounts are connected for this client yet.{" "}
          <Link
            href={`${base}/accounts` as Route}
            className="text-brand-red underline underline-offset-4"
          >
            Connect one
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

function uniqueProviders(providers: SocialProvider[]): SocialProvider[] {
  return [...new Set(providers)].sort();
}

/** The formats the client's connected platforms can actually carry. */
function uniqueTypes(providers: SocialProvider[]): SocialPostType[] {
  const types = new Set<SocialPostType>();
  for (const provider of new Set(providers)) {
    for (const type of CAPABILITIES[provider].postTypes) types.add(type as SocialPostType);
  }
  return [...types].sort();
}
