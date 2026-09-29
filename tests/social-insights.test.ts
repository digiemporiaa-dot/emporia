import { describe, expect, it } from "vitest";
import {
  aggregateRate,
  best,
  byCampaign,
  byHour,
  byType,
  byWeekday,
  dailyTrend,
  engagementRate,
  lowest,
  MIN_SAMPLE,
  reportedTrendKeys,
  type InsightPost,
} from "@/lib/social/insights";
import { contentTag, utmValue } from "@/lib/social/utm";
import type { MetricKey } from "@/lib/social/metrics";

/**
 * The rules behind "when to post", "by format", "campaigns", "least
 * engagement" and the trends. Absent is not zero throughout; slots are in
 * India time; "best" needs a real sample.
 */

const blank: Record<MetricKey, number | null> = {
  impressions: null,
  reach: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  clicks: null,
  videoViews: null,
  profileVisits: null,
  followersGained: null,
};

let n = 0;
function post(at: string, metrics: Partial<Record<MetricKey, number | null>>, extra: Partial<InsightPost> = {}): InsightPost {
  n += 1;
  const id = `p${n}`;
  return {
    postId: id,
    itemId: `i${n}`,
    title: `Post ${n}`,
    provider: "INSTAGRAM",
    type: "REEL",
    publishedAt: new Date(at),
    externalUrl: null,
    campaign: null,
    row: { postId: id, provider: extra.provider ?? "INSTAGRAM", ...blank, ...metrics },
    ...extra,
  };
}

describe("engagementRate", () => {
  it("is engagement over reach, as a percentage — the brief's example", () => {
    expect(engagementRate({ ...blank, reach: 18_492, likes: 1_102, comments: 84, shares: 127, saves: 241 })!.toFixed(2)).toBe("8.40");
  });

  it("is null without reach, or with no engagement figure at all", () => {
    expect(engagementRate({ ...blank, likes: 10 })).toBeNull();
    expect(engagementRate({ ...blank, reach: 0, likes: 10 })).toBeNull();
    expect(engagementRate({ ...blank, reach: 500 })).toBeNull();
  });
});

describe("when to post", () => {
  it("buckets by the day and hour in India, not UTC", () => {
    // 20:00 UTC Sunday is 01:30 IST Monday.
    const late = post("2026-10-04T20:00:00Z", { likes: 5 });
    const days = byWeekday([late]);
    expect(days.find((d) => d.label === "Mon")!.posts).toBe(1);
    expect(days.find((d) => d.label === "Sun")!.posts).toBe(0);
    expect(days).toHaveLength(7);
    expect(byHour([late]).map((h) => h.label)).toEqual(["01:00"]);
  });

  it("counts an unmeasured post as a post, never as a zero in the average", () => {
    const slots = byWeekday([
      post("2026-10-05T06:00:00Z", { likes: 100 }),
      post("2026-10-05T07:00:00Z", {}),
    ]);
    const monday = slots.find((d) => d.label === "Mon")!;
    expect(monday).toMatchObject({ posts: 2, measured: 1, avgEngagement: 100 });
  });

  it(`crowns a slot only with at least ${MIN_SAMPLE} measured posts`, () => {
    const lucky = [post("2026-10-06T06:00:00Z", { likes: 900 })]; // one Tuesday post
    const steady = [0, 1, 2].map((i) => post(`2026-10-07T0${6 + i}:00:00Z`, { likes: 50 })); // three Wednesday posts
    const slots = byWeekday([...lucky, ...steady]);
    expect(best(slots)?.label).toBe("Wed");
    expect(best(byWeekday(lucky))).toBeNull();
  });
});

describe("format, campaign and weakest posts", () => {
  it("groups formats per platform", () => {
    const rows = byType([
      post("2026-10-05T06:00:00Z", { likes: 10 }, { type: "REEL" }),
      post("2026-10-05T06:00:00Z", { likes: 30 }, { type: "CAROUSEL" }),
      post("2026-10-05T06:00:00Z", { likes: 5 }, { provider: "LINKEDIN", type: "TEXT" }),
    ]);
    expect(rows.map((r) => `${r.provider}:${r.type}`)).toEqual(["INSTAGRAM:CAROUSEL", "INSTAGRAM:REEL", "LINKEDIN:TEXT"]);
  });

  it("ranks campaigns by engagement rate, and sums reach only where reported", () => {
    const a = { id: "a", name: "Big but flat" };
    const b = { id: "b", name: "Small but loved" };
    const rows = byCampaign([
      post("2026-10-05T06:00:00Z", { reach: 10_000, likes: 100 }, { campaign: a }),
      post("2026-10-05T06:00:00Z", { likes: 40 }, { campaign: a }),
      post("2026-10-05T06:00:00Z", { reach: 1_000, likes: 90 }, { campaign: b }),
      post("2026-10-05T06:00:00Z", { reach: 1_000, likes: 10 }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Small but loved", "Big but flat"]);
    expect(rows[1]).toMatchObject({ reach: 10_000, reachReporting: 1, posts: 2 });
  });

  it("leaves unmeasured posts out of the weakest list", () => {
    const unknown = post("2026-10-05T06:00:00Z", {});
    const weak = post("2026-10-05T06:00:00Z", { likes: 1 });
    const strong = post("2026-10-05T06:00:00Z", { likes: 50 });
    expect(lowest([strong, unknown, weak]).map((p) => p.postId)).toEqual([weak.postId, strong.postId]);
  });
});

describe("dailyTrend", () => {
  const snap = (postId: string, day: string, m: Partial<Record<MetricKey, number | null>>) => ({ postId, day, ...blank, ...m });

  it("shows what each day added: the first snapshot in full, then the rise", () => {
    const points = dailyTrend(
      [
        snap("a", "2026-10-01", { impressions: 100, likes: 10 }),
        snap("a", "2026-10-02", { impressions: 160, likes: 14 }),
        snap("b", "2026-10-02", { impressions: 40, likes: 2 }),
      ],
      ["2026-10-01", "2026-10-02", "2026-10-03"],
    );
    expect(points[0]).toMatchObject({ impressions: 100, engagement: 10 });
    expect(points[1]).toMatchObject({ impressions: 60 + 40, engagement: 4 + 2 });
    expect(points[2]).toMatchObject({ impressions: null, engagement: null });
  });

  it("keeps a metric nobody reported null, and never counts a total after a gap as one day's rise", () => {
    const points = dailyTrend(
      [snap("a", "2026-10-01", { likes: 5, reach: null }), snap("a", "2026-10-02", { likes: 8, reach: 900 })],
      ["2026-10-01", "2026-10-02"],
    );
    expect(points.map((p) => p.reach)).toEqual([null, null]);
    expect(reportedTrendKeys(points)).toEqual(["engagement"]);
  });
});

describe("aggregateRate", () => {
  it("is total engagement over total reach, from posts that reported both", () => {
    const rate = aggregateRate([
      { ...blank, reach: 1_000, likes: 100 },
      { ...blank, reach: 9_000, likes: 180 },
      { ...blank, likes: 5_000 }, // no reach: left out, not a distortion
    ]);
    expect(rate.reporting).toBe(2);
    expect(rate.value).toBeCloseTo(2.8, 5); // not (10% + 2%) / 2
    expect(aggregateRate([{ ...blank, likes: 3 }])).toEqual({ value: null, reporting: 0 });
  });
});

describe("contentTag", () => {
  it("is the format and the id's tail, in UTM form", () => {
    expect(contentTag("CAROUSEL", "cmabcdef0123k3j9x2ab")).toBe("carousel-k3j9x2ab");
    expect(utmValue("Diwali 2026")).toBe("diwali-2026");
  });
});
