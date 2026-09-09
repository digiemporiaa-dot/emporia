import { z } from "zod";
import { slugSchema } from "@/lib/validation/slug";
import { ICON_NAMES } from "@/lib/content/icons";
import { caseBodySchema, postBodySchema, serviceBodySchema } from "@/lib/content/entity-body";

/**
 * The website content library.
 *
 * Services, blog posts, case studies, testimonials and standalone FAQs. Every
 * one of these models already existed and was already rendered by the public
 * site; until now the only thing that wrote them was the demo seed, so this is
 * the validation that was missing rather than a new content system.
 *
 * `body` is the same schema the renderer parses with
 * (lib/content/entity-body.ts), so the editor cannot save a shape the page
 * would then drop.
 */

const publishStatus = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);
const order = z.coerce.number().int().min(0).max(9999).default(0);

/** A relation the editor may leave unset. An empty select posts "". */
const optionalId = z
  .string()
  .trim()
  .max(40)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .default(null);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const serviceSchema = z.object({
  name: z.string().trim().min(2, "Enter a service name.").max(120),
  slug: slugSchema,
  shortDescription: z
    .string()
    .trim()
    .min(10, "Write a one-line description — it is used across the site.")
    .max(300),
  // Constrained to the curated set the renderer knows how to draw; anything
  // else would render as nothing at all.
  icon: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null)
    .refine(
      (value) => value === null || (ICON_NAMES as readonly string[]).includes(value),
      "Choose an icon from the list.",
    ),
  heroMediaId: optionalId,
  status: publishStatus.default("DRAFT"),
  order,
  body: serviceBodySchema.default({}),
});
export type ServiceInput = z.infer<typeof serviceSchema>;

// ---------------------------------------------------------------------------
// Blog
// ---------------------------------------------------------------------------

export const blogCategorySchema = z.object({
  name: z.string().trim().min(2, "Enter a category name.").max(80),
  slug: slugSchema,
  description: optionalText(300),
});
export type BlogCategoryInput = z.infer<typeof blogCategorySchema>;

export const blogPostSchema = z.object({
  title: z.string().trim().min(3, "Enter a title.").max(200),
  slug: slugSchema,
  excerpt: optionalText(400),
  coverId: optionalId,
  // Required by the model: a post is written by somebody, and the byline is
  // rendered publicly.
  authorId: z.string().trim().min(1, "Choose an author."),
  categoryId: optionalId,
  status: publishStatus.default("DRAFT"),
  /**
   * Free text rather than a tag picker: tags are created on demand, and making
   * an editor leave the post to create one first is how tag lists rot.
   */
  tags: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  body: postBodySchema.default({}),
});
export type BlogPostInput = z.infer<typeof blogPostSchema>;

// ---------------------------------------------------------------------------
// Case study
// ---------------------------------------------------------------------------

export const caseStudyMetricSchema = z.object({
  label: z.string().trim().min(1, "Every metric needs a label.").max(80),
  /**
   * A string, not a number. These are figures like "3.4x", "+180%" or "₹4.2L"
   * as the client agreed them, and coercing them to a number would both lose
   * the notation and invite arithmetic on a claim (CLAUDE.md 2 rule 1).
   */
  value: z.string().trim().min(1, "Every metric needs a value.").max(40),
  unit: optionalText(20),
});
export type CaseStudyMetricInput = z.infer<typeof caseStudyMetricSchema>;

export const caseStudySchema = z.object({
  title: z.string().trim().min(3, "Enter a title.").max(200),
  slug: slugSchema,
  clientName: z.string().trim().min(1, "Name the client.").max(120),
  summary: z.string().trim().min(10, "Write a one-paragraph summary.").max(600),
  serviceId: optionalId,
  cityId: optionalId,
  coverId: optionalId,
  status: publishStatus.default("DRAFT"),
  metrics: z.array(caseStudyMetricSchema).max(8).default([]),
  body: caseBodySchema.default({}),
});
export type CaseStudyInput = z.infer<typeof caseStudySchema>;

// ---------------------------------------------------------------------------
// Testimonial
// ---------------------------------------------------------------------------

export const testimonialSchema = z.object({
  authorName: z.string().trim().min(2, "Who said it?").max(120),
  authorRole: optionalText(120),
  company: optionalText(120),
  quote: z.string().trim().min(10, "Enter the quote.").max(1200),
  /** Blank means "no rating given", which is different from one star. */
  rating: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(5)])
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null),
  avatarId: optionalId,
  serviceId: optionalId,
  cityId: optionalId,
  status: publishStatus.default("DRAFT"),
  order,
});
export type TestimonialInput = z.infer<typeof testimonialSchema>;

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

export const faqSchema = z.object({
  question: z.string().trim().min(5, "Enter the question.").max(300),
  answer: z.string().trim().min(5, "Enter the answer.").max(3000),
  serviceId: optionalId,
  cityId: optionalId,
  packageId: optionalId,
  order,
  isActive: z.boolean().default(true),
});
export type FaqInput = z.infer<typeof faqSchema>;
