/**
 * Reading an experiment, without overclaiming.
 *
 * The plan's requirement, and the honest one: **no winner is declared without a
 * defensible sample.** Below the threshold this reports how far off it is
 * rather than showing a percentage that would be read as a result.
 *
 * ## What this test is, and what it is not
 *
 * A two-proportion z-test. It answers one narrow question: if both arms
 * converted at the same underlying rate, how surprising would a gap this large
 * be? It does not tell you which arm is better in any richer sense, it assumes
 * visitors are independent, and it is a normal approximation that is unreliable
 * when the expected count in any cell is small — which is exactly what the
 * minimum sample below guards against.
 *
 * ## Peeking
 *
 * Checking a running test repeatedly and stopping when it first looks
 * significant inflates the false-positive rate well past the nominal 5%. This
 * module cannot prevent that, so the report says so on screen instead of
 * pretending a mid-flight p-value means what an end-of-test one would.
 */

/**
 * The smallest sample worth reading.
 *
 * A convention, not a law, and the one worth arguing with: below a hundred
 * visitors per arm the normal approximation is shaky and the confidence
 * interval is wider than any effect a page change realistically produces.
 * Changing it here changes the product.
 */
export const MIN_EXPOSURES_PER_ARM = 100;

/** And enough conversions that a single extra lead does not move the verdict. */
export const MIN_CONVERSIONS_TOTAL = 10;

export type ArmResult = {
  key: string;
  name: string;
  exposures: number;
  conversions: number;
  /** Null when nobody was exposed — a rate over zero people is not zero. */
  rate: number | null;
};

export type ExperimentReading =
  | {
      state: "no-data";
      arms: ArmResult[];
      /** What is still needed before this can be read at all. */
      needed: string;
    }
  | {
      state: "too-early";
      arms: ArmResult[];
      needed: string;
    }
  | {
      state: "no-difference";
      arms: ArmResult[];
      pValue: number;
    }
  | {
      state: "difference";
      arms: ArmResult[];
      pValue: number;
      /** The arm with the higher rate. Not "the winner" — see the caveats. */
      leader: string;
    };

/**
 * The standard normal CDF, by Abramowitz–Stegun 7.1.26.
 *
 * Accurate to about 1.5e-7, which is far finer than any decision made from a
 * p-value rounded to two figures.
 */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;

  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);

  return 0.5 * (1 + sign * y);
}

/** Two-sided p-value for a difference in two proportions. */
export function twoProportionP(
  aConversions: number,
  aExposures: number,
  bConversions: number,
  bExposures: number,
): number | null {
  if (aExposures <= 0 || bExposures <= 0) return null;

  const pooled = (aConversions + bConversions) / (aExposures + bExposures);
  // Both arms all-converting or none-converting: there is no variance to
  // measure, so there is no test to run rather than a division by zero.
  if (pooled <= 0 || pooled >= 1) return null;

  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / aExposures + 1 / bExposures));
  if (standardError === 0) return null;

  const z = (aConversions / aExposures - bConversions / bExposures) / standardError;
  return 2 * (1 - normalCdf(Math.abs(z)));
}

/** The threshold at which a difference is reported as one. */
export const ALPHA = 0.05;

/**
 * Read an experiment.
 *
 * Deliberately refuses more often than it declares. Two arms only: comparing
 * three at once needs a correction for multiple comparisons, and a report that
 * quietly omitted one would be worse than one that says it cannot.
 */
export function read(arms: readonly ArmResult[]): ExperimentReading {
  const list = [...arms];

  const totalExposures = list.reduce((sum, arm) => sum + arm.exposures, 0);
  if (totalExposures === 0) {
    return { state: "no-data", arms: list, needed: "Nobody has seen this test yet." };
  }

  if (list.length !== 2) {
    return {
      state: "too-early",
      arms: list,
      needed:
        list.length < 2
          ? "An experiment needs two arms to compare."
          : "Reading more than two arms at once needs a correction this does not apply, so no verdict is offered.",
    };
  }

  const [a, b] = list as [ArmResult, ArmResult];
  const shortfall = list
    .filter((arm) => arm.exposures < MIN_EXPOSURES_PER_ARM)
    .map((arm) => `${arm.name} needs ${MIN_EXPOSURES_PER_ARM - arm.exposures} more visitors`);

  const conversions = a.conversions + b.conversions;

  if (shortfall.length > 0 || conversions < MIN_CONVERSIONS_TOTAL) {
    const parts = [...shortfall];
    if (conversions < MIN_CONVERSIONS_TOTAL) {
      parts.push(`${MIN_CONVERSIONS_TOTAL - conversions} more conversions between them`);
    }
    return { state: "too-early", arms: list, needed: parts.join(", ") };
  }

  const pValue = twoProportionP(a.conversions, a.exposures, b.conversions, b.exposures);
  if (pValue === null) {
    return {
      state: "too-early",
      arms: list,
      needed: "Every visitor converted, or none did — there is nothing to compare yet.",
    };
  }

  if (pValue >= ALPHA) return { state: "no-difference", arms: list, pValue };

  const leader = (a.rate ?? 0) >= (b.rate ?? 0) ? a : b;
  return { state: "difference", arms: list, pValue, leader: leader.name };
}
