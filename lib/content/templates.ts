import { BLOCK_SCHEMAS, isBlockType, type BlockType } from "@/lib/content/blocks";
import { migrateContent, stampVersion } from "@/lib/content/migrations";

/**
 * What a template permits.
 *
 * Pure, and in `lib/content` rather than beside the template service, because
 * both that service and `page.service` need it — and importing one service from
 * the other would be a cycle.
 */

/** The block types a template permits, or an empty list meaning "all of them". */
export function allowedBlocksOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && isBlockType(entry));
}

/**
 * May this block go on this page?
 *
 * A page with no template, or one whose template permits everything, permits
 * everything: the restriction is opt-in per template rather than the default
 * state of the CMS. A template that meant to allow nothing would be a template
 * for a page nobody can build.
 */
export function templatePermits(allowed: readonly string[], type: string): boolean {
  return allowed.length === 0 || allowed.includes(type);
}

/**
 * The bands a template starts a page with, migrated forward.
 *
 * A template written before a block's shape changed must still produce a page
 * that renders, so its stored content goes through the migration ladder on the
 * way out — exactly as a restored version does (17.1b-v).
 */
export function startingSections(sections: unknown): { type: BlockType; content: unknown }[] {
  if (!Array.isArray(sections)) return [];

  return sections.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as { type?: unknown; content?: unknown };
    if (typeof row.type !== "string" || !isBlockType(row.type)) return [];

    const migrated = migrateContent(row.content, row.type);
    const result = BLOCK_SCHEMAS[row.type].safeParse(migrated);
    // A band that no longer parses is dropped rather than failing the whole
    // creation: a broken template should cost one section, not the page.
    if (!result.success) return [];

    return [{ type: row.type, content: stampVersion(result.data) }];
  });
}
