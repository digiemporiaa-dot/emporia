import { z } from "zod";
import { BLOCK_SCHEMAS } from "@/lib/content/blocks";
import { migrateContent } from "@/lib/content/migrations";

/**
 * PageSection content schemas.
 *
 * Section content is stored as JSON, so it is parsed with zod before render
 * rather than trusted (CLAUDE.md 2 rule 4). A section whose content does not
 * match its declared type is skipped instead of crashing the page — bad CMS
 * data should degrade one band of a page, not take the whole route down.
 */

/**
 * `hero` used to be declared here as a loose shape. It moved into
 * BLOCK_SCHEMAS when the builder gained a hero block, on the same terms `cta`
 * moved before it: the block's schema is a superset, so every existing row on
 * the homepage, About and the rest still parses and still renders — they are
 * simply editable now, and can carry an image and a background.
 */

export const proseSection = z.object({
  heading: z.string().optional(),
  paragraphs: z.array(z.string()),
});

export const valuesSection = z.object({
  heading: z.string().optional(),
  items: z.array(z.object({ title: z.string(), text: z.string() })),
});

export const rolesSection = z.object({
  heading: z.string().optional(),
  items: z.array(
    z.object({
      title: z.string(),
      location: z.string().optional(),
      type: z.string().optional(),
      summary: z.string().optional(),
    }),
  ),
  emptyMessage: z.string().optional(),
});

export const legalSection = z.object({
  updatedAt: z.string().optional(),
  intro: z.string().optional(),
  clauses: z.array(z.object({ heading: z.string(), text: z.string() })),
});

/**
 * Every section type that can appear on a page.
 *
 * `cta`, `hero`, `positioning`, `process` and `industries` used to be declared
 * here. Each moved into BLOCK_SCHEMAS as the builder gained a block for it, and
 * each block schema is a superset of the shape this file held — so every
 * existing row on the homepage and elsewhere still parses and still renders.
 * They are simply editable now too.
 *
 * Two families, deliberately kept distinct:
 *
 *   BLOCK_SCHEMAS   general-purpose builder blocks, offered in Add Section
 *   the rest        bespoke bands composed by hand for the homepage, About,
 *                   Careers and the legal pages
 *
 * The bespoke ones stay because live pages are built from them; they are simply
 * not offered in the builder, because "industries" or "legal" is not something
 * you would drop onto an arbitrary landing page. Migrate, don't bulldoze
 * (CLAUDE.md 2 rule 10).
 */
export const SECTION_SCHEMAS = {
  ...BLOCK_SCHEMAS,
  prose: proseSection,
  values: valuesSection,
  roles: rolesSection,
  legal: legalSection,
} as const;

export type SectionType = keyof typeof SECTION_SCHEMAS;
export type SectionContent<T extends SectionType> = z.infer<(typeof SECTION_SCHEMAS)[T]>;

export type RawSection = { id: string; type: string; order: number; content: unknown };

export type ParsedSection = {
  [K in SectionType]: { id: string; type: K; content: SectionContent<K> };
}[SectionType];

/**
 * Parse stored sections, dropping any that do not validate. Returns the ones
 * that are safe to render, in order.
 */
export function parseSections(sections: readonly RawSection[]): ParsedSection[] {
  const parsed: ParsedSection[] = [];

  for (const section of sections) {
    const type = section.type as SectionType;
    const schema = SECTION_SCHEMAS[type];
    if (!schema) continue;

    // Brought forward before validation, so a block whose shape changed in a
    // later release still parses instead of being dropped and blanking the
    // band (lib/content/migrations.ts). In memory only — nothing is written.
    const result = schema.safeParse(migrateContent(section.content, type));
    if (!result.success) continue;

    parsed.push({ id: section.id, type, content: result.data } as ParsedSection);
  }

  return parsed;
}

/** Find one section of a given type, for pages that compose bespoke layouts. */
export function findSection<T extends SectionType>(
  sections: readonly ParsedSection[],
  type: T,
): SectionContent<T> | null {
  const found = sections.find((s) => s.type === type);
  return found ? (found.content as SectionContent<T>) : null;
}
