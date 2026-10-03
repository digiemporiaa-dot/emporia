import { addDays, maxDay, minDay } from "@/lib/seo-intel/dates";

/**
 * Which Search Console days one sync run fetches. Pure.
 *
 * Every run re-reads the most recent days, because Google keeps revising
 * them for a few days ("fresh" data becomes final). Then, until the history
 * reaches the oldest day Google keeps (about 16 months), it walks one chunk
 * further back — so a new connection fills its history over a few runs
 * instead of one run making a thousand API calls.
 */

export const GSC_RECENT_DAYS = 5;
export const GSC_BACKFILL_DAYS_PER_RUN = 30;
/** Search Console keeps 16 months. */
export const GSC_HISTORY_DAYS = 486;

export type SyncRange = { start: string; end: string; kind: "recent" | "backfill" };

export function planGscSync(input: {
  /** Today in Pacific time. */
  today: string;
  /** The earliest day already fetched, or null before the first sync. */
  backfilledFrom: string | null;
  recentDays?: number;
  backfillDays?: number;
  historyDays?: number;
}): { ranges: SyncRange[]; oldest: string; end: string; nextBackfilledFrom: string; backfillComplete: boolean } {
  const recentDays = input.recentDays ?? GSC_RECENT_DAYS;
  const backfillDays = input.backfillDays ?? GSC_BACKFILL_DAYS_PER_RUN;
  const historyDays = input.historyDays ?? GSC_HISTORY_DAYS;

  // Yesterday is the latest day Google can have anything for.
  const end = addDays(input.today, -1);
  const oldest = addDays(end, -(historyDays - 1));
  const recentStart = maxDay(oldest, addDays(end, -(recentDays - 1)));
  const ranges: SyncRange[] = [{ start: recentStart, end, kind: "recent" }];

  // Where history currently starts. Never later than the recent window, and a
  // cursor from a longer-ago run cannot point past the oldest day kept.
  const from = input.backfilledFrom ? maxDay(oldest, minDay(input.backfilledFrom, recentStart)) : recentStart;

  let nextBackfilledFrom = from;
  if (from > oldest) {
    const chunkEnd = addDays(from, -1);
    const chunkStart = maxDay(oldest, addDays(from, -backfillDays));
    ranges.push({ start: chunkStart, end: chunkEnd, kind: "backfill" });
    nextBackfilledFrom = chunkStart;
  }

  return { ranges, oldest, end, nextBackfilledFrom, backfillComplete: nextBackfilledFrom <= oldest };
}
