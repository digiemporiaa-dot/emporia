/**
 * Google review figures for one listing (Phase 8). Pure.
 *
 * Counts and averages come from the stored reviews; Google's own average and
 * total for the whole listing are shown beside them, not mixed in.
 */

export type ReviewRow = { rating: number; createdAt: Date; replyComment: string | null; repliedAt: Date | null };

const DAY = 86_400_000;

export type ReviewStats = {
  total: number;
  last30: number;
  previous30: number;
  /** Average stars of reviews from the last 90 days, null with none. */
  recentAverage: number | null;
  allAverage: number | null;
  unanswered: number;
  unansweredLow: number;
  /** Median hours from review to reply, over replied reviews from the last 90 days. */
  medianReplyHours: number | null;
  daysSinceLast: number | null;
};

export function reviewStats(reviews: readonly ReviewRow[], now: Date, options: { unansweredDays: number; lowRating: number }): ReviewStats {
  const age = (date: Date) => (now.getTime() - date.getTime()) / DAY;
  const recent = reviews.filter((review) => age(review.createdAt) <= 90);
  const unanswered = reviews.filter((review) => !review.replyComment && age(review.createdAt) <= options.unansweredDays);
  const replyHours = recent
    .filter((review) => review.repliedAt && review.repliedAt >= review.createdAt)
    .map((review) => ((review.repliedAt as Date).getTime() - review.createdAt.getTime()) / 3_600_000)
    .sort((a, b) => a - b);
  const latest = reviews.reduce<Date | null>((max, review) => (!max || review.createdAt > max ? review.createdAt : max), null);
  const average = (rows: readonly ReviewRow[]) => (rows.length ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length : null);
  return {
    total: reviews.length,
    last30: reviews.filter((review) => age(review.createdAt) <= 30).length,
    previous30: reviews.filter((review) => age(review.createdAt) > 30 && age(review.createdAt) <= 60).length,
    recentAverage: average(recent),
    allAverage: average(reviews),
    unanswered: unanswered.length,
    unansweredLow: unanswered.filter((review) => review.rating <= options.lowRating).length,
    medianReplyHours: replyHours.length ? median(replyHours) : null,
    daysSinceLast: latest ? Math.floor(age(latest)) : null,
  };
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** New reviews and average stars per calendar month (UTC), oldest first, `months` long ending this month. */
export function monthlyReviews(reviews: readonly ReviewRow[], now: Date, months = 12): { month: string; count: number; average: number | null }[] {
  const out: { month: string; count: number; sum: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ month: date.toISOString().slice(0, 7), count: 0, sum: 0 });
  }
  const index = new Map(out.map((row, i) => [row.month, i]));
  for (const review of reviews) {
    const i = index.get(review.createdAt.toISOString().slice(0, 7));
    if (i === undefined) continue;
    const row = out[i] as { count: number; sum: number };
    row.count += 1;
    row.sum += review.rating;
  }
  return out.map((row) => ({ month: row.month, count: row.count, average: row.count ? row.sum / row.count : null }));
}
