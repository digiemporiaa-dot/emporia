import type { RankProvider } from "@/lib/seo-intel/providers/types";

/**
 * The configured rank provider. None is (decision D2): rankings come from
 * Search Console's average position, and exact rank, volume, difficulty and
 * CPC show as not configured rather than as numbers.
 */
export function rankProvider(): RankProvider | null {
  return null;
}
