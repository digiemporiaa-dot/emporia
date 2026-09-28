/**
 * The metric vocabulary, shared by the service and the screens.
 *
 * Deliberately outside `social-metrics.service.ts`, which is `server-only`:
 * the report is a client component and needs the keys and the labels, and
 * importing them from the service would drag the database into the browser
 * bundle. Constants that both sides need are not service internals.
 */

/** The metric columns, in the order a report reads them. */
export const METRIC_KEYS = [
  "impressions",
  "reach",
  "likes",
  "comments",
  "shares",
  "saves",
  "clicks",
  "videoViews",
  "profileVisits",
  "followersGained",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export const METRIC_LABEL: Record<MetricKey, string> = {
  impressions: "Impressions",
  reach: "Reach",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  clicks: "Clicks",
  videoViews: "Video views",
  profileVisits: "Profile visits",
  followersGained: "Followers gained",
};

/**
 * A total, and how much of the truth it represents.
 *
 * `value` is null when no post reported the metric at all — which reads very
 * differently from zero, and is the difference between "nobody engaged" and
 * "the platform does not tell us".
 */
export type MetricTotal = {
  value: number | null;
  /** How many posts contributed a figure. */
  reporting: number;
  /** How many posts were in scope, reporting or not. */
  total: number;
};
