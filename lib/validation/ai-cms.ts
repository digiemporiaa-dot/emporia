import { z } from "zod";
import { BLOCK_LIBRARY } from "@/lib/content/blocks";

/** The CMS assistant. */

/**
 * What to do to a piece of copy.
 *
 * A closed list rather than a free-text instruction. An open prompt box on a
 * field is a prompt-injection surface and an unbounded cost, and neither is
 * worth it for the four things anyone actually asks for.
 */
export const REWRITE_ACTIONS = [
  "rewrite",
  "shorten",
  "expand",
  "formal",
  "plain",
  "translate",
] as const;

export type RewriteAction = (typeof REWRITE_ACTIONS)[number];

export const REWRITE_LABEL: Record<RewriteAction, string> = {
  rewrite: "Rewrite",
  shorten: "Make it shorter",
  expand: "Say more",
  formal: "More formal",
  plain: "Plainer English",
  translate: "Translate",
};

export const rewriteSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(2, "There is nothing to rewrite.")
      // Bounded: the cost of a call is the length of what is sent, and a field
      // holding a whole page is a field that should be split, not rewritten.
      .max(4_000, "That is too long to rewrite in one go."),
    action: z.enum(REWRITE_ACTIONS),
    /** Required for translate, ignored otherwise. */
    language: z.string().trim().max(40).optional(),
  })
  .refine((value) => value.action !== "translate" || Boolean(value.language), {
    path: ["language"],
    message: "Say which language to translate into.",
  });

export type RewriteInput = z.infer<typeof rewriteSchema>;

const BLOCK_TYPES = BLOCK_LIBRARY.map((block) => block.type) as [string, ...string[]];

export const generateBlocksSchema = z.object({
  pageId: z.string().min(1).max(40),
  /** What the page is about, in the editor's own words. */
  brief: z
    .string()
    .trim()
    .min(10, "Say what the page is about.")
    .max(1_000, "Keep the brief to a paragraph."),
  /**
   * Which bands to draft. The editor chooses the shape; the model fills it.
   * Letting the model choose its own structure produced pages that ignored the
   * template's allowed blocks and had to be thrown away.
   */
  blocks: z
    .array(z.enum(BLOCK_TYPES))
    .min(1, "Choose at least one band.")
    .max(8, "Eight bands is plenty for a first draft."),
});

export type GenerateBlocksInput = z.infer<typeof generateBlocksSchema>;

/**
 * The drafted bands, on their way back onto the page.
 *
 * The content is `unknown` here on purpose: each block's own schema is the
 * authority on its shape, and it runs in the service. Re-describing thirty
 * block shapes at this boundary would create a second, weaker copy of that
 * rule which would drift the first time a block gained a field.
 */
export const addDraftedSectionsSchema = z.object({
  pageId: z.string().min(1).max(40),
  blocks: z
    .array(z.object({ type: z.enum(BLOCK_TYPES), content: z.unknown() }))
    .min(1, "There is nothing to add.")
    .max(8, "Eight bands is plenty for a first draft."),
});

export type AddDraftedSectionsInput = z.infer<typeof addDraftedSectionsSchema>;

export const generateMetaSchema = z.object({
  pageId: z.string().min(1).max(40),
});

export type GenerateMetaInput = z.infer<typeof generateMetaSchema>;
