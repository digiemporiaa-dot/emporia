/**
 * Which arm a visitor is in.
 *
 * Deterministic and unstored: the same visitor and the same experiment always
 * produce the same variant, so a person does not see the page change under them
 * between visits, and assignment costs no database read on the render path and
 * no write.
 *
 * The hash is FNV-1a — small, fast, and stable across processes and restarts,
 * which is the property that matters here. It is not a cryptographic hash and
 * does not need to be: nothing is being protected, only spread evenly.
 */

export type VariantChoice = {
  id: string;
  key: string;
  /** Relative share. Zero excludes the arm without deleting it. */
  weight: number;
};

/** FNV-1a, 32-bit. Stable across runtimes; that is the requirement. */
export function hash(input: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    value ^= input.charCodeAt(i);
    // The FNV prime, by shifts, to stay in 32-bit integer arithmetic.
    value = (value + ((value << 1) + (value << 4) + (value << 7) + (value << 8) + (value << 24))) >>> 0;
  }
  return value >>> 0;
}

/**
 * Pick an arm for this visitor.
 *
 * Salted with the experiment key so a visitor is not systematically in the
 * first arm of everything — two experiments running at once would otherwise
 * assign the same people the same way and confound each other.
 *
 * Returns null when there is nothing to assign: no variants, or every weight
 * at zero. A caller with no assignment shows the page as it is, which is the
 * right behaviour for an experiment that has been emptied.
 */
export function assign(
  visitorId: string,
  experimentKey: string,
  variants: readonly VariantChoice[],
): VariantChoice | null {
  const usable = variants.filter((variant) => variant.weight > 0);
  if (usable.length === 0) return null;

  const total = usable.reduce((sum, variant) => sum + variant.weight, 0);
  // Ordered by key so the buckets do not move when someone renames a variant
  // or the query returns rows in a different order — either would reassign
  // every visitor mid-test and invalidate the result.
  const ordered = [...usable].sort((a, b) => a.key.localeCompare(b.key));

  const bucket = hash(`${experimentKey}:${visitorId}`) % total;

  let seen = 0;
  for (const variant of ordered) {
    seen += variant.weight;
    if (bucket < seen) return variant;
  }

  // Unreachable while the weights sum to `total`; returning the last arm is
  // still better than returning null on an arithmetic surprise.
  return ordered[ordered.length - 1] ?? null;
}
