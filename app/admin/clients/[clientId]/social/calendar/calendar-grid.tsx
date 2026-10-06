import { bucketByDay, WEEKDAYS, type CalendarGrid } from "@/lib/social/calendar";
import type { CalendarCard as Card } from "@/lib/services/social-calendar.service";
import { CalendarCard } from "./calendar-card";
import { CONTENT_STAGES, CONTENT_STAGE_LABEL } from "@/lib/projects/lifecycle";

/**
 * The grid itself, in four shapes.
 *
 * All four read from the same bucketed map, so a post cannot appear on the 6th
 * in one view and the 5th in another. The bucketing happens once, here, in the
 * calendar's zone.
 */

const DAY_LABEL = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** A month cell shows this many before it collapses into a count. */
const CELL_LIMIT = 3;

/** Occasions on a day: marked on the calendar, never posted for. */
function OccasionMarks({ names }: { names: readonly string[] | undefined }) {
  if (!names?.length) return null;
  return (
    <ul className="space-y-0.5" aria-label="Occasions">
      {names.map((name) => (
        <li key={name} className="truncate rounded bg-navy-50 px-1 text-[10px] font-medium text-navy-700" title={name}>
          {name}
        </li>
      ))}
    </ul>
  );
}

export function CalendarBody({
  grid,
  cards,
  base,
  timeZone,
  occasions,
}: {
  grid: CalendarGrid;
  cards: Card[];
  base: string;
  timeZone: string;
  /** The client's occasions, by `YYYY-MM-DD`. */
  occasions?: ReadonlyMap<string, string[]>;
}) {
  const timeFormat = new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

  const buckets = bucketByDay(
    cards,
    (card) => (card.effectiveAt ? new Date(card.effectiveAt) : null),
    timeZone,
  );

  // A day cell needs a label that reads in UTC, since the grid's days are
  // plain calendar dates rather than instants.
  const labelFor = (day: { year: number; month: number; day: number }) =>
    DAY_LABEL.format(new Date(Date.UTC(day.year, day.month - 1, day.day, 12)));

  if (grid.view === "board") {
    // Read-only on purpose: a stage moves through internal review and the
    // client's decision, which a drag between columns would skip.
    const ordered = [...cards].sort((a, b) => (a.effectiveAt ?? "").localeCompare(b.effectiveAt ?? ""));
    return (
      <div className="space-y-2">
        <p className="text-2xs text-ink-subtle">
          This month&rsquo;s versions by where their idea is in the workflow. Stages move through review and
          approval on each idea&rsquo;s page.
        </p>
        <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 relative overflow-x-auto pb-2">
          {CONTENT_STAGES.map((stage) => {
            const column = ordered.filter((card) => card.stage === stage);
            return (
              <section key={stage} aria-label={CONTENT_STAGE_LABEL[stage]} className="min-w-0 rounded-lg border border-line bg-surface-muted p-2">
                <h3 className="mb-2 flex items-center justify-between px-1 text-xs font-medium text-navy-800">
                  {CONTENT_STAGE_LABEL[stage]}
                  <span className="text-2xs font-normal text-ink-subtle">{column.length}</span>
                </h3>
                {column.length === 0 ? (
                  <p className="px-1 py-3 text-2xs text-ink-subtle">Nothing here.</p>
                ) : (
                  <ul className="space-y-2">
                    {column.map((card) => (
                      <li key={card.id}>
                        <CalendarCard card={card} density="full" base={base} timeFormat={timeFormat} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  if (grid.view === "list") {
    const populated = grid.days.filter(
      (day) => (buckets.get(day.key)?.length ?? 0) > 0 || (occasions?.get(day.key)?.length ?? 0) > 0,
    );

    if (populated.length === 0) return <Empty />;

    return (
      <ol className="divide-y divide-line rounded-lg border border-line bg-white">
        {populated.map((day) => (
          <li key={day.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:gap-4">
            <div className="sm:w-32 sm:shrink-0">
              <p
                className={
                  day.isToday
                    ? "text-xs font-semibold text-brand-red-text"
                    : "text-xs font-medium text-navy-800"
                }
              >
                {labelFor(day)}
              </p>
              <p className="text-2xs text-ink-subtle">
                {buckets.get(day.key)?.length ?? 0} post{(buckets.get(day.key)?.length ?? 0) === 1 ? "" : "s"}
              </p>
              <div className="mt-1">
                <OccasionMarks names={occasions?.get(day.key)} />
              </div>
            </div>
            <ul className="grid flex-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {(buckets.get(day.key) ?? []).map((card) => (
                <li key={card.id}>
                  <CalendarCard card={card} density="full" base={base} timeFormat={timeFormat} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    );
  }

  if (grid.view === "day") {
    const day = grid.days[0]!;
    const items = buckets.get(day.key) ?? [];
    const marks = occasions?.get(day.key);
    if (items.length === 0 && !marks?.length) return <Empty />;
    return (
      <div className="space-y-2">
        {marks?.length ? (
          <div className="max-w-xs">
            <OccasionMarks names={marks} />
          </div>
        ) : null}
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((card) => (
            <li key={card.id}>
              <CalendarCard card={card} density="full" base={base} timeFormat={timeFormat} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (grid.view === "week") {
    return (
      <div className="relative overflow-x-auto">
        <div className="grid min-w-3xl grid-cols-7 gap-px rounded-lg border border-line bg-line">
          {grid.days.map((day) => (
            <div key={`head-${day.key}`} className="bg-surface-muted px-2 py-1.5">
              <p
                className={
                  day.isToday
                    ? "text-2xs font-semibold uppercase tracking-wide text-brand-red-text"
                    : "text-2xs font-semibold uppercase tracking-wide text-ink-subtle"
                }
              >
                {labelFor(day)}
              </p>
            </div>
          ))}
          {grid.days.map((day) => {
            const items = buckets.get(day.key) ?? [];
            return (
              <div key={day.key} className="min-h-40 space-y-1 bg-white p-1.5">
                <OccasionMarks names={occasions?.get(day.key)} />
                {items.length === 0 ? (
                  <p className="pt-3 text-center text-2xs text-ink-subtle">—</p>
                ) : (
                  // Compact, not full: a seventh of the width is not enough for
                  // a thumbnail anyone could read. The day and list views are
                  // where the creative is worth showing.
                  items.map((card) => (
                    <CalendarCard
                      key={card.id}
                      card={card}
                      density="compact"
                      base={base}
                      timeFormat={timeFormat}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-x-auto">
      <div className="grid min-w-3xl grid-cols-7 gap-px rounded-lg border border-line bg-line">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="bg-surface-muted px-2 py-1.5 text-2xs font-semibold uppercase tracking-widest text-ink-subtle"
          >
            {weekday}
          </div>
        ))}

        {grid.days.map((day) => {
          const items = buckets.get(day.key) ?? [];
          const shown = items.slice(0, CELL_LIMIT);
          const hidden = items.length - shown.length;

          return (
            <div
              key={day.key}
              className={
                day.inPeriod ? "min-h-28 space-y-0.5 bg-white p-1" : "min-h-28 space-y-0.5 bg-surface-muted/60 p-1"
              }
            >
              <p
                className={
                  day.isToday
                    ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-red text-2xs font-semibold tabular-nums text-white"
                    : day.inPeriod
                      ? "px-1 text-2xs tabular-nums text-ink-muted"
                      : "px-1 text-2xs tabular-nums text-ink-subtle/60"
                }
              >
                {day.day}
              </p>
              <OccasionMarks names={occasions?.get(day.key)} />
              {shown.map((card) => (
                <CalendarCard
                  key={card.id}
                  card={card}
                  density="compact"
                  base={base}
                  timeFormat={timeFormat}
                />
              ))}
              {hidden > 0 ? (
                <p className="px-1 text-[10px] text-ink-subtle">+{hidden} more</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <p className="rounded-lg border border-dashed border-line-strong px-4 py-12 text-center text-sm text-ink-subtle">
      Nothing scheduled in this period.
    </p>
  );
}
