"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/actor";
import {
  blogCategorySchema,
  blogPostSchema,
  caseStudySchema,
  faqSchema,
  testimonialSchema,
} from "@/lib/validation/content";
import * as blog from "@/lib/services/blog.service";
import * as caseStudies from "@/lib/services/case-study.service";
import * as testimonials from "@/lib/services/testimonial.service";
import * as faqs from "@/lib/services/faq.service";
import { toActionFailure, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/logger";

/**
 * Website content library server actions.
 *
 * Each one: authenticate, validate with zod, then hand off to the service,
 * which performs the permission check and writes the audit row. No business
 * logic lives here (CLAUDE.md 4).
 */

const actionLog = log("content-library");

function fields(formData: FormData): Record<string, unknown> {
  return Object.fromEntries(formData.entries());
}

/** A structured field the form posts as JSON. Unparseable means invalid. */
function json(value: FormDataEntryValue | null, fallback: unknown): unknown {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const checked = (value: unknown) => value === "on" || value === "true";

function rejected(error: unknown, where: string): ActionResult<never> {
  actionLog.error({ err: error, where }, "content action failed");
  return toActionFailure(error);
}

function invalid(issues: { path: PropertyKey[]; message: string }[]): ActionResult<never> {
  const details: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.join(".");
    (details[key] ??= []).push(issue.message);
  }
  return {
    ok: false,
    code: "VALIDATION",
    message: issues[0]?.message ?? "Check the form.",
    details,
  };
}

export type SavedState = ActionResult<{ id: string }> | null;

// ---------------------------------------------------------------------------
// Blog posts
// ---------------------------------------------------------------------------

export async function savePostAction(_prev: SavedState, formData: FormData): Promise<SavedState> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);
    const id = typeof raw["id"] === "string" ? raw["id"] : "";

    const parsed = blogPostSchema.safeParse({
      ...raw,
      tags: json(formData.get("tags"), []),
      body: json(formData.get("body"), {}),
    });
    if (!parsed.success) return invalid(parsed.error.issues);

    const post = id
      ? await blog.updatePost(actor, id, parsed.data)
      : await blog.createPost(actor, parsed.data);

    revalidatePath("/admin/website/blog");
    return { ok: true, data: { id: post.id } };
  } catch (error) {
    return rejected(error, "savePost");
  }
}

export async function deletePostAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await blog.deletePost(actor, id);
    revalidatePath("/admin/website/blog");
    return { ok: true, data: { id } };
  } catch (error) {
    return rejected(error, "deletePost");
  }
}

export async function saveCategoryAction(
  _prev: SavedState,
  formData: FormData,
): Promise<SavedState> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);
    const id = typeof raw["id"] === "string" ? raw["id"] : "";

    const parsed = blogCategorySchema.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error.issues);

    const category = id
      ? await blog.updateCategory(actor, id, parsed.data)
      : await blog.createCategory(actor, parsed.data);

    revalidatePath("/admin/website/blog/categories");
    return { ok: true, data: { id: category.id } };
  } catch (error) {
    return rejected(error, "saveCategory");
  }
}

export async function deleteCategoryAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await blog.deleteCategory(actor, id);
    revalidatePath("/admin/website/blog/categories");
    return { ok: true, data: { id } };
  } catch (error) {
    return rejected(error, "deleteCategory");
  }
}

// ---------------------------------------------------------------------------
// Case studies
// ---------------------------------------------------------------------------

export async function saveCaseStudyAction(
  _prev: SavedState,
  formData: FormData,
): Promise<SavedState> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);
    const id = typeof raw["id"] === "string" ? raw["id"] : "";

    const parsed = caseStudySchema.safeParse({
      ...raw,
      metrics: json(formData.get("metrics"), []),
      body: json(formData.get("body"), {}),
    });
    if (!parsed.success) return invalid(parsed.error.issues);

    const study = id
      ? await caseStudies.updateCaseStudy(actor, id, parsed.data)
      : await caseStudies.createCaseStudy(actor, parsed.data);

    revalidatePath("/admin/website/case-studies");
    return { ok: true, data: { id: study.id } };
  } catch (error) {
    return rejected(error, "saveCaseStudy");
  }
}

export async function deleteCaseStudyAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await caseStudies.deleteCaseStudy(actor, id);
    revalidatePath("/admin/website/case-studies");
    return { ok: true, data: { id } };
  } catch (error) {
    return rejected(error, "deleteCaseStudy");
  }
}

// ---------------------------------------------------------------------------
// Testimonials
// ---------------------------------------------------------------------------

export async function saveTestimonialAction(
  _prev: SavedState,
  formData: FormData,
): Promise<SavedState> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);
    const id = typeof raw["id"] === "string" ? raw["id"] : "";

    const parsed = testimonialSchema.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error.issues);

    const testimonial = id
      ? await testimonials.updateTestimonial(actor, id, parsed.data)
      : await testimonials.createTestimonial(actor, parsed.data);

    revalidatePath("/admin/website/testimonials");
    return { ok: true, data: { id: testimonial.id } };
  } catch (error) {
    return rejected(error, "saveTestimonial");
  }
}

export async function deleteTestimonialAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await testimonials.deleteTestimonial(actor, id);
    revalidatePath("/admin/website/testimonials");
    return { ok: true, data: { id } };
  } catch (error) {
    return rejected(error, "deleteTestimonial");
  }
}

// ---------------------------------------------------------------------------
// FAQs
// ---------------------------------------------------------------------------

export async function saveFaqAction(_prev: SavedState, formData: FormData): Promise<SavedState> {
  try {
    const actor = await requireActor();
    const raw = fields(formData);
    const id = typeof raw["id"] === "string" ? raw["id"] : "";

    // An unchecked checkbox is absent from the payload entirely, so the toggle
    // has to be resolved explicitly or "off" would parse as undefined.
    const parsed = faqSchema.safeParse({ ...raw, isActive: checked(raw["isActive"]) });
    if (!parsed.success) return invalid(parsed.error.issues);

    const faq = id
      ? await faqs.updateFaq(actor, id, parsed.data)
      : await faqs.createFaq(actor, parsed.data);

    revalidatePath("/admin/website/faqs");
    return { ok: true, data: { id: faq.id } };
  } catch (error) {
    return rejected(error, "saveFaq");
  }
}

export async function deleteFaqAction(id: string): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    await faqs.deleteFaq(actor, id);
    revalidatePath("/admin/website/faqs");
    return { ok: true, data: { id } };
  } catch (error) {
    return rejected(error, "deleteFaq");
  }
}
