import { describe, expect, it } from "vitest";
import { DEFAULT_CHANGE_THRESHOLDS } from "@/lib/seo-intel/engine/changes";
import { changeThresholds, DEFAULT_THRESHOLDS, mergeThresholds, THRESHOLD_DEFS, THRESHOLD_KEYS } from "@/lib/seo-intel/thresholds";
import { decaying } from "@/lib/seo-intel/engine/content";

describe("SEO thresholds", () => {
  it("defaults match the rules' documented values", () => {
    expect(DEFAULT_THRESHOLDS["opportunities.minImpressions"]).toBe(50);
    expect(DEFAULT_THRESHOLDS["decay.minDrop"]).toBe(0.25);
    expect(DEFAULT_THRESHOLDS["cannibal.minShare"]).toBe(0.2);
    expect(DEFAULT_THRESHOLDS["opportunities.commandCenterCap"]).toBe(25);
    expect(changeThresholds(DEFAULT_THRESHOLDS)).toEqual(DEFAULT_CHANGE_THRESHOLDS);
  });

  it("every default sits inside its own range", () => {
    for (const key of THRESHOLD_KEYS) {
      const def = THRESHOLD_DEFS[key];
      expect(def.default, key).toBeGreaterThanOrEqual(def.min);
      expect(def.default, key).toBeLessThanOrEqual(def.max);
    }
  });

  it("layers agency values over defaults and website values over both", () => {
    const merged = mergeThresholds(
      [{ key: "decay.minClicks", value: 10 }, { key: "cannibal.minShare", value: 0.3 }],
      [{ key: "decay.minClicks", value: 5 }],
    );
    expect(merged["decay.minClicks"]).toBe(5);
    expect(merged["cannibal.minShare"]).toBe(0.3);
    expect(merged["lowCtr.share"]).toBe(0.5);
  });

  it("ignores unknown keys and non-numbers, and clamps stored values to range", () => {
    const merged = mergeThresholds([
      { key: "not.a.setting", value: 9 },
      { key: "decay.minDrop", value: Number.NaN },
      { key: "cannibal.minShare", value: 0.9 },
      { key: "decay.minClicks", value: -4 },
    ]);
    expect(merged).not.toHaveProperty("not.a.setting");
    expect(merged["decay.minDrop"]).toBe(0.25);
    expect(merged["cannibal.minShare"]).toBe(0.5);
    expect(merged["decay.minClicks"]).toBe(1);
  });

  it("changes a rule's outcome when passed in", () => {
    const page = { url: "/p", blocks: [{ clicks: 20, impressions: 200, position: 3 }, { clicks: 15, impressions: 200, position: 3 }, { clicks: 10, impressions: 200, position: 3 }] as const };
    const blocks = { url: page.url, blocks: [...page.blocks] as [typeof page.blocks[0], typeof page.blocks[1], typeof page.blocks[2]] };
    expect(decaying([blocks], () => null)).toHaveLength(0);
    expect(decaying([blocks], () => null, mergeThresholds([{ key: "decay.minClicks", value: 20 }]))).toHaveLength(1);
  });
});
