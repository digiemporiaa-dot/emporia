import { z } from "zod";
import { BLOCK_LIBRARY } from "@/lib/content/blocks";

/**
 * Page templates.
 *
 * A template says three things: which bands a page of this kind starts with,
 * which bands it may contain at all, and what its SEO defaults to.
 */

const BLOCK_TYPES = BLOCK_LIBRARY.map((definition) => definition.type) as [string, ...string[]];

export const templateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2, "Give the template a handle.")
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Lower-case letters, numbers and dashes only."),
  name: z.string().trim().min(2, "Name the template.").max(100),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional(),
  /**
   * The bands a new page starts with. Content is optional per entry: a
   * template that says "start with a hero and an FAQ" without dictating the
   * words is the common case, and the block's own defaults fill the rest.
   */
  sections: z
    .array(
      z.object({
        type: z.enum(BLOCK_TYPES),
        content: z.unknown().optional(),
      }),
    )
    .max(30, "Thirty bands is more than a starting point.")
    .default([]),
  /**
   * Block types this template permits. **Empty means every block.**
   *
   * A restriction is a decision worth making deliberately — a legal page that
   * may not carry a pricing table — not the default state of every template.
   */
  allowedBlocks: z.array(z.enum(BLOCK_TYPES)).default([]),
  defaultSchemaType: z
    .enum(["NONE", "ORGANIZATION", "WEBSITE", "SERVICE", "LOCAL_BUSINESS", "ARTICLE", "FAQ_PAGE"])
    .default("NONE"),
  defaultRobotsIndex: z.coerce.boolean().default(true),
  isActive: z.coerce.boolean().default(true),
  order: z.coerce.number().int().min(0).max(9999).default(0),
});

export type TemplateInput = z.infer<typeof templateSchema>;

/**
 * Creating a page from a template.
 *
 * The template is optional — a blank page is still a page, and requiring a
 * choice would make templates a tax rather than a shortcut.
 */
export const pageFromTemplateSchema = z.object({
  title: z.string().trim().min(2, "Give the page a title.").max(200),
  slug: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : undefined)),
  templateId: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type PageFromTemplateInput = z.infer<typeof pageFromTemplateSchema>;
