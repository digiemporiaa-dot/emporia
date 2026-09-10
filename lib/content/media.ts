import "server-only";
import { db } from "@/lib/db";
import { mediaIdsIn } from "@/lib/content/blocks";
import type { ParsedSection } from "@/lib/content/sections";

/**
 * Image resolution for page sections.
 *
 * Blocks store a `mediaId` and nothing else, so a replaced or re-described
 * image is correct everywhere it appears rather than leaving stale copies of
 * its URL scattered through section JSON.
 *
 * One batched query per page, keyed by id — never a lookup per section.
 */

export type ResolvedImage = {
  id: string;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  /** Focal point, whole percentages. Null means centre. */
  focalX: number | null;
  focalY: number | null;
  /** Default caption, for blocks that show one and have none of their own. */
  caption: string | null;
};

export type SectionImages = ReadonlyMap<string, ResolvedImage>;

export async function resolveSectionImages(
  sections: readonly ParsedSection[],
): Promise<SectionImages> {
  const ids = new Set<string>();
  for (const section of sections) {
    for (const id of mediaIdsIn(section.type, section.content)) ids.add(id);
  }
  if (ids.size === 0) return new Map();

  const rows = await db.media.findMany({
    // A deleted image is not silently swapped for another; the block that
    // referenced it simply renders without one.
    where: { id: { in: [...ids] }, deletedAt: null },
    select: {
      id: true,
      url: true,
      alt: true,
      width: true,
      height: true,
      focalX: true,
      focalY: true,
      caption: true,
    },
  });

  return new Map(rows.map((row) => [row.id, row]));
}
