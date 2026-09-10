import { z } from "zod";
import { pageParamsSchema } from "@/lib/paging";
import { pageSlugSchema, slugSchema } from "@/lib/validation/slug";

/**
 * Website page CMS validation.
 *
 * Shared between the admin forms and the server actions, so the browser and the
 * server agree on the rules and the server never trusts the browser having
 * applied them (CLAUDE.md 2 rule 4).
 *
 * Section *content* is deliberately not validated here. Each block type owns
 * its own schema in lib/content/sections.ts, and the builder that produces
 * those payloads arrives with the block editor. This module validates the page
 * envelope and the section's position in it.
 */

export const publishStatusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
export type PublishStatusInput = z.infer<typeof publishStatusSchema>;

export const pageSchema = z.object({
  title: z.string().trim().min(2, "Enter a page title.").max(160),
  /**
   * Format only. Whether a reserved slug is allowed depends on whether this
   * page already holds it — `home`, `about` and the other bespoke routes read
   * their sections from a CMS page with exactly that slug, and those pages must
   * stay editable. Only the service knows the current slug, so only the service
   * can decide (see assertSlugFree).
   */
  slug: slugSchema,
  internalName: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  status: publishStatusSchema.default("DRAFT"),
});
export type PageInput = z.infer<typeof pageSchema>;

/**
 * Creating a page from a title alone; the slug is derived. Used by the "new
 * page" flow, where asking for a slug before a title has been typed is
 * friction for no benefit.
 */
export const pageDraftSchema = z.object({
  title: z.string().trim().min(2, "Enter a page title.").max(160),
  slug: pageSlugSchema.optional(),
});
export type PageDraftInput = z.infer<typeof pageDraftSchema>;

/**
 * Server-side list controls. The full table is never sent to the browser
 * (CLAUDE.md 12), and the paging bounds come from the shared helper rather than
 * being restated here.
 */
export const pageListSchema = pageParamsSchema.extend({
  query: z.string().trim().max(120).optional(),
  status: publishStatusSchema.optional(),
  /**
   * `deleted` lists the bin. Without it, soft-deleted pages would be
   * unreachable from the admin and "delete" would be irreversible in practice
   * despite the row still being there.
   */
  view: z.enum(["active", "deleted"]).default("active"),
});
export type PageListInput = z.infer<typeof pageListSchema>;

/** One slot in a page. `content` is checked against its block schema on save. */
export const pageSectionSchema = z.object({
  type: z.string().trim().min(1).max(60),
  content: z.unknown(),
  name: z.string().trim().max(120).nullable().optional(),
  isVisible: z.boolean().default(true),
  reusableSectionId: z.string().cuid().nullable().optional(),
});
export type PageSectionInput = z.infer<typeof pageSectionSchema>;

/** Drag-and-drop reorder payload. */
export const sectionOrderSchema = z
  .array(z.object({ id: z.string().cuid(), order: z.number().int().min(0) }))
  .min(1, "Nothing to reorder.")
  .max(200);
export type SectionOrderInput = z.infer<typeof sectionOrderSchema>;

/**
 * A reusable section's own key. Not `pageSlugSchema`: a reusable section has no
 * URL, so the reserved-route list has nothing to say about it — `services` is a
 * perfectly good name for a reusable band.
 */
export const reusableSectionSchema = z.object({
  key: slugSchema,
  name: z.string().trim().min(2, "Name this section.").max(120),
  type: z.string().trim().min(1).max(60),
  status: publishStatusSchema.default("DRAFT"),
  isGlobal: z.boolean().default(false),
});
/** Creating one: the type is fixed at creation, content comes from defaults. */
export const reusableSectionDraftSchema = z.object({
  name: z.string().trim().min(2, "Name this section.").max(120),
  type: z.string().trim().min(1).max(60),
  isGlobal: z.boolean().default(false),
});
export type ReusableSectionDraftInput = z.infer<typeof reusableSectionDraftSchema>;

export const reusableListSchema = pageParamsSchema.extend({
  query: z.string().trim().max(120).optional(),
  status: publishStatusSchema.optional(),
});
export type ReusableListInput = z.infer<typeof reusableListSchema>;
export type ReusableSectionInput = z.infer<typeof reusableSectionSchema>;

/**
 * A workflow transition.
 *
 * The note is where a reviewer says what needs changing, so it is worth a
 * length that fits a real sentence or three — and worth being optional, because
 * "approved" rarely needs one.
 */
export const workflowNoteSchema = z.object({
  workflow: z.enum(["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED"]),
  note: z
    .string()
    .trim()
    .max(1000, "Keep the note under 1000 characters.")
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
});

export type WorkflowNoteInput = z.infer<typeof workflowNoteSchema>;

/** Why a version was taken by hand. Blank is allowed; the service names it. */
export const versionReasonSchema = z.object({
  reason: z.string().trim().max(200, "Keep the description under 200 characters."),
});

/**
 * When a page should go up and come down.
 *
 * Separate from `pageSchema` on purpose, and gated on `pages.publish` rather
 * than `pages.edit`: scheduling a publish *is* publishing, just later. Folding
 * it into the settings form would let anyone who can fix a typo put a page
 * live by choosing a date.
 *
 * Both are ISO strings from the browser, which converts from the operator's own
 * clock. Blank clears the schedule.
 */
const scheduledAt = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .default(null)
  .refine(
    (value) => value === null || !Number.isNaN(Date.parse(value)),
    "That is not a valid date and time.",
  )
  .transform((value) => (value === null ? null : new Date(value)));

export const pageScheduleSchema = z
  .object({ publishAt: scheduledAt, unpublishAt: scheduledAt })
  .refine(
    (value) => !value.publishAt || !value.unpublishAt || value.unpublishAt > value.publishAt,
    {
      path: ["unpublishAt"],
      message: "The page cannot come down before it goes up.",
    },
  );

export type PageScheduleInput = z.infer<typeof pageScheduleSchema>;
