import { z } from "zod";
import { toCsv } from "@/lib/csv/serialise";

/**
 * The frozen contents of a monthly social report (brief §32).
 *
 * Written once, when the report is generated, from stored metrics and stored
 * content — never from a model — and validated on the way in and out, so the
 * portal renders exactly what was generated. A figure nobody reported is
 * `null`, with how many posts reported it beside it; it is never a zero.
 */

const total = z.object({ value: z.number().nullable(), reporting: z.number().int(), total: z.number().int() });
const provider = z.enum(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "YOUTUBE", "X", "GOOGLE_BUSINESS_PROFILE"]);
const postType = z.enum([
  "SINGLE_IMAGE",
  "CAROUSEL",
  "VIDEO",
  "REEL",
  "STORY",
  "TEXT",
  "LINK",
  "YOUTUBE_VIDEO",
  "YOUTUBE_SHORT",
  "GBP_POST",
]);

const periodFigures = z.object({
  posts: z.number().int(),
  measured: z.number().int(),
  reach: total,
  impressions: total,
  engagement: total,
  followersGained: total,
  rate: z.object({ value: z.number().nullable(), reporting: z.number().int() }),
});

export const socialReportDataSchema = z.object({
  version: z.literal(1),
  clientName: z.string().max(300),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  generatedAt: z.string(),
  current: periodFigures,
  /** The month before, for month-over-month; same rules. */
  previous: periodFigures,
  byProvider: z.array(z.object({ provider, posts: z.number().int(), measured: z.number().int(), rate: z.number().nullable() })).max(10),
  topPost: z
    .object({
      title: z.string().max(300),
      provider,
      type: postType,
      publishedAt: z.string(),
      externalUrl: z.string().max(2000).nullable(),
      reach: z.number(),
      engagement: z.number(),
      rate: z.number(),
    })
    .nullable(),
  topPlatform: z.object({ provider, rate: z.number() }).nullable(),
  topCampaign: z.object({ name: z.string().max(300), rate: z.number() }).nullable(),
  /** What was published, as facts: formats, campaigns and pillars by count. */
  content: z.object({
    formats: z.array(z.object({ provider, type: postType, posts: z.number().int(), avgRate: z.number().nullable() })).max(60),
    campaigns: z.array(z.object({ name: z.string().max(300), posts: z.number().int(), rate: z.number().nullable() })).max(50),
    pillars: z.array(z.object({ name: z.string().max(300), posts: z.number().int() })).max(50),
  }),
  /** The next month as planned when the report was generated. */
  nextMonth: z.object({
    month: z.string(),
    ideas: z.number().int(),
    versions: z.number().int(),
    byStage: z.array(z.object({ stage: z.string(), ideas: z.number().int() })),
    items: z
      .array(z.object({ title: z.string().max(300), day: z.string().nullable(), stage: z.string(), platforms: z.array(provider) }))
      .max(40),
  }),
  truncated: z.boolean(),
});

export type SocialReportData = z.infer<typeof socialReportDataSchema>;

export function readReportData(value: unknown): SocialReportData | null {
  const parsed = socialReportDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** "September 2026" for `2026-09`. */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, m - 1, 1)));
}

/** A spreadsheet of the report's figures: one row per fact, never a formula. */
export function reportCsv(data: SocialReportData): string {
  const rows: (string | number | null)[][] = [["Section", "Item", "Value", "Reported by", "Of posts"]];
  const add = (section: string, item: string, value: string | number | null, reporting?: number, of?: number) =>
    rows.push([section, item, value, reporting ?? null, of ?? null]);
  const figures = (label: string, period: z.infer<typeof periodFigures>) => {
    add(label, "Posts published", period.posts);
    for (const key of ["reach", "impressions", "engagement", "followersGained"] as const) {
      const t = period[key];
      add(label, key === "followersGained" ? "Followers gained" : key[0]!.toUpperCase() + key.slice(1), t.value, t.reporting, t.total);
    }
    add(label, "Engagement rate %", period.rate.value === null ? null : period.rate.value.toFixed(2), period.rate.reporting, period.posts);
  };
  figures(monthLabel(data.month), data.current);
  figures("Previous month", data.previous);
  for (const p of data.byProvider) add("Platforms", p.provider, p.posts, p.measured, p.posts);
  if (data.topPost) add("Top post", data.topPost.title, `${data.topPost.rate.toFixed(2)}%`);
  if (data.topPlatform) add("Top platform", data.topPlatform.provider, `${data.topPlatform.rate.toFixed(2)}%`);
  if (data.topCampaign) add("Top campaign", data.topCampaign.name, `${data.topCampaign.rate.toFixed(2)}%`);
  for (const f of data.content.formats) add("Formats", `${f.provider} ${f.type}`, f.posts);
  for (const c of data.content.campaigns) add("Campaigns", c.name, c.posts);
  for (const p of data.content.pillars) add("Pillars", p.name, p.posts);
  for (const i of data.nextMonth.items) add(`Plan for ${monthLabel(data.nextMonth.month)}`, i.title, i.day ?? "No date");

  // The shared writer quotes as needed and defuses anything a spreadsheet
  // would run as a formula — titles are free text.
  const [headers, ...body] = rows;
  return toCsv(
    headers!.map(String),
    body.map((row) => row.map((v) => (v === null ? "" : String(v)))),
  );
}
