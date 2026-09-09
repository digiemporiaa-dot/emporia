import { z } from "zod";

/**
 * The `body` JSON on Service, BlogPost and CaseStudy.
 *
 * These three columns are `Json?`, and the public pages have always validated
 * them before render rather than trusting them. The schemas used to be
 * declared inline in each page component, which was fine while the only writer
 * was the demo seed. Now that the admin writes them too, the editor and the
 * renderer have to agree on the shape, and agreeing means one definition
 * (CLAUDE.md 4 — shared logic lives in exactly one place).
 *
 * Every field is optional. A body written before a field existed still parses,
 * and a section the editor left blank simply does not render.
 */

const text = (max: number) => z.string().trim().max(max);

/** Service page: the long-form pitch under the hero. */
export const serviceBodySchema = z.object({
  intro: text(2000).optional(),
  approach: text(2000).optional(),
  deliverables: z.array(text(200)).max(20).optional(),
});
export type ServiceBody = z.infer<typeof serviceBodySchema>;

/** Blog post: a standfirst plus headed sections. */
export const postBodySchema = z.object({
  lead: text(600).optional(),
  sections: z
    .array(z.object({ heading: text(200), text: text(6000) }))
    .max(40)
    .optional(),
});
export type PostBody = z.infer<typeof postBodySchema>;

/** Case study: the three-part narrative the public template renders. */
export const caseBodySchema = z.object({
  challenge: text(4000).optional(),
  approach: text(4000).optional(),
  outcome: text(4000).optional(),
});
export type CaseBody = z.infer<typeof caseBodySchema>;

/**
 * Parse a stored body, falling back to an empty one.
 *
 * The renderer's posture towards bad CMS data everywhere else: degrade the
 * band, never the page.
 */
export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  return parsed.success ? parsed.data : ({} as T);
}
