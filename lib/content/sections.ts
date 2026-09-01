import { z } from "zod";

/**
 * PageSection content schemas.
 *
 * Section content is stored as JSON, so it is parsed with zod before render
 * rather than trusted (CLAUDE.md 2 rule 4). A section whose content does not
 * match its declared type is skipped instead of crashing the page — bad CMS
 * data should degrade one band of a page, not take the whole route down.
 */

export const heroSection = z.object({
  eyebrow: z.string().optional(),
  heading: z.string(),
  body: z.string().optional(),
  ctaLabel: z.string().optional(),
  ctaHref: z.string().optional(),
  secondaryLabel: z.string().optional(),
  secondaryHref: z.string().optional(),
  facts: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
});

export const positioningSection = z.object({
  eyebrow: z.string().optional(),
  heading: z.string(),
  paragraphs: z.array(z.string()),
});

export const processSection = z.object({
  eyebrow: z.string().optional(),
  heading: z.string(),
  steps: z.array(z.object({ title: z.string(), text: z.string() })),
});

export const industriesSection = z.object({
  eyebrow: z.string().optional(),
  heading: z.string(),
  body: z.string().optional(),
  items: z.array(z.string()),
});

export const ctaSection = z.object({
  heading: z.string(),
  body: z.string().optional(),
  ctaLabel: z.string(),
  ctaHref: z.string(),
});

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

export const SECTION_SCHEMAS = {
  hero: heroSection,
  positioning: positioningSection,
  process: processSection,
  industries: industriesSection,
  cta: ctaSection,
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

    const result = schema.safeParse(section.content);
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
