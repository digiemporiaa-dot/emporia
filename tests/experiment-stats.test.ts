import { describe, expect, it } from "vitest";
import {
  ALPHA,
  MIN_CONVERSIONS_TOTAL,
  MIN_EXPOSURES_PER_ARM,
  read,
  twoProportionP,
  type ArmResult,
} from "@/lib/experiments/stats";
import { assign, hash } from "@/lib/experiments/assign";

/**
 * Reading an experiment.
 *
 * The p-values below are checked against values a two-proportion z-test is
 * known to produce, because a statistics module nobody has checked against a
 * reference is a statistics module that quietly reports nonsense.
 */

const arm = (over: Partial<ArmResult> & { key: string }): ArmResult => ({
  name: over.key,
  exposures: 0,
  conversions: 0,
  rate: null,
  ...over,
});

const withRate = (key: string, conversions: number, exposures: number): ArmResult => ({
  key,
  name: key,
  exposures,
  conversions,
  rate: exposures === 0 ? null : conversions / exposures,
});

describe("two-proportion z-test", () => {
  it("gives no p-value when an arm has nobody in it", () => {
    expect(twoProportionP(0, 0, 5, 100)).toBeNull();
  });

  it("gives no p-value when nobody converted at all", () => {
    // Pooled rate of zero: no variance, so there is nothing to test rather
    // than a division by zero.
    expect(twoProportionP(0, 100, 0, 100)).toBeNull();
  });

  it("gives no p-value when everybody converted", () => {
    expect(twoProportionP(100, 100, 100, 100)).toBeNull();
  });

  it("reports p = 1 for two identical arms", () => {
    expect(twoProportionP(10, 100, 10, 100)).toBeCloseTo(1, 6);
  });

  it("matches a known result: 10/100 against 20/100", () => {
    // z = -1.98030, two-sided p = 0.0476704, computed independently rather
    // than by hand — the first two references written here were both wrong,
    // and a statistics module checked against a bad reference is worse than
    // one checked against none.
    const p = twoProportionP(10, 100, 20, 100);
    expect(p).not.toBeNull();
    expect(p!).toBeCloseTo(0.0476704, 6);
  });

  it("matches a known result: 100/1000 against 150/1000", () => {
    // z = -3.38062, two-sided p = 0.00072323. The approximation this module
    // uses is documented as accurate to ~1.5e-7, which is the tolerance here.
    const p = twoProportionP(100, 1000, 150, 1000);
    expect(p!).toBeCloseTo(0.00072323, 6);
  });

  it("matches a known result on a wide gap: 50/1000 against 100/1000", () => {
    // z = -4.24476, two-sided p = 0.00002188.
    expect(twoProportionP(50, 1000, 100, 1000)!).toBeCloseTo(0.00002188, 7);
  });

  it("is symmetric — swapping the arms does not change the p-value", () => {
    const forward = twoProportionP(12, 400, 30, 400);
    const backward = twoProportionP(30, 400, 12, 400);
    expect(forward).toBeCloseTo(backward!, 12);
  });

  it("shrinks as the same gap is seen in a bigger sample", () => {
    const small = twoProportionP(10, 100, 15, 100)!;
    const large = twoProportionP(100, 1000, 150, 1000)!;
    expect(large).toBeLessThan(small);
  });
});

describe("refusing a verdict", () => {
  it("says so when nobody has seen the test", () => {
    const reading = read([arm({ key: "a" }), arm({ key: "b" })]);
    expect(reading.state).toBe("no-data");
  });

  it("refuses below the minimum sample, and says how far off it is", () => {
    const reading = read([withRate("a", 5, 50), withRate("b", 9, 50)]);
    expect(reading.state).toBe("too-early");
    expect(reading.state === "too-early" && reading.needed).toMatch(/50 more visitors/);
  });

  it("refuses when there are enough visitors but too few conversions", () => {
    // A verdict a single extra lead could flip is not a verdict.
    const reading = read([withRate("a", 1, 500), withRate("b", 3, 500)]);
    expect(reading.state).toBe("too-early");
    expect(reading.state === "too-early" && reading.needed).toMatch(/more conversions/);
  });

  it("refuses to read a single arm", () => {
    const reading = read([withRate("a", 50, 500)]);
    expect(reading.state).toBe("too-early");
  });

  it("refuses to read three arms rather than applying no correction", () => {
    const reading = read([
      withRate("a", 50, 500),
      withRate("b", 60, 500),
      withRate("c", 70, 500),
    ]);
    expect(reading.state).toBe("too-early");
    expect(reading.state === "too-early" && reading.needed).toMatch(/correction/);
  });
});

describe("declaring a difference", () => {
  it("reports no difference when the arms are alike", () => {
    const reading = read([withRate("a", 50, 500), withRate("b", 52, 500)]);
    expect(reading.state).toBe("no-difference");
  });

  it("reports a difference, and names the higher arm without calling it a winner", () => {
    const reading = read([withRate("Control", 50, 1000), withRate("Variant B", 100, 1000)]);
    expect(reading.state).toBe("difference");
    expect(reading.state === "difference" && reading.leader).toBe("Variant B");
    expect(reading.state === "difference" && reading.pValue).toBeLessThan(ALPHA);
  });

  it("holds the thresholds where the module says they are", () => {
    expect(MIN_EXPOSURES_PER_ARM).toBe(100);
    expect(MIN_CONVERSIONS_TOTAL).toBe(10);
    expect(ALPHA).toBe(0.05);
  });
});

describe("deterministic assignment", () => {
  const variants = [
    { id: "1", key: "control", weight: 1 },
    { id: "2", key: "b", weight: 1 },
  ];

  it("gives the same visitor the same arm every time", () => {
    const first = assign("visitor-123", "hero-test", variants);
    for (let i = 0; i < 20; i += 1) {
      expect(assign("visitor-123", "hero-test", variants)?.key).toBe(first?.key);
    }
  });

  it("gives the same visitor different arms in different experiments", () => {
    // Salted by experiment key, so two tests running at once do not assign the
    // same people the same way and confound each other.
    const keys = new Set(
      ["a", "b", "c", "d", "e", "f"].map((k) => assign("visitor-123", k, variants)?.key),
    );
    expect(keys.size).toBeGreaterThan(1);
  });

  it("splits roughly evenly across many visitors", () => {
    let control = 0;
    const n = 10_000;
    for (let i = 0; i < n; i += 1) {
      if (assign(`visitor-${i}`, "split-test", variants)?.key === "control") control += 1;
    }
    // Well inside what a fair split produces; a broken hash lands far outside.
    expect(control / n).toBeGreaterThan(0.45);
    expect(control / n).toBeLessThan(0.55);
  });

  it("honours weights", () => {
    const weighted = [
      { id: "1", key: "control", weight: 3 },
      { id: "2", key: "b", weight: 1 },
    ];
    let control = 0;
    const n = 10_000;
    for (let i = 0; i < n; i += 1) {
      if (assign(`v-${i}`, "weighted", weighted)?.key === "control") control += 1;
    }
    expect(control / n).toBeGreaterThan(0.72);
    expect(control / n).toBeLessThan(0.78);
  });

  it("never assigns an arm weighted to zero", () => {
    const paused = [
      { id: "1", key: "control", weight: 1 },
      { id: "2", key: "b", weight: 0 },
    ];
    for (let i = 0; i < 500; i += 1) {
      expect(assign(`v-${i}`, "paused", paused)?.key).toBe("control");
    }
  });

  it("assigns nothing when there is nothing to assign", () => {
    expect(assign("v", "empty", [])).toBeNull();
    expect(assign("v", "all-zero", [{ id: "1", key: "a", weight: 0 }])).toBeNull();
  });

  it("does not move buckets when a variant is renamed", () => {
    // Ordered by key, so the split is stable against row order and renames of
    // the *name*. Reassigning mid-test would invalidate the result.
    const forward = assign("visitor-7", "stable", variants)?.key;
    const reversed = assign("visitor-7", "stable", [...variants].reverse())?.key;
    expect(forward).toBe(reversed);
  });

  it("hashes stably", () => {
    expect(hash("abc")).toBe(hash("abc"));
    expect(hash("abc")).not.toBe(hash("abd"));
  });
});
