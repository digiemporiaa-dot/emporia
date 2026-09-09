import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { CACHE_TAGS } from "@/lib/content/queries";
import type { Actor } from "@/lib/actor/types";
import type { TestimonialInput } from "@/lib/validation/content";

/**
 * Testimonials.
 *
 * A testimonial is a claim attributed to a named person, so there is no
 * generator, no AI draft and no import path into this model — it is typed by
 * someone who has the quote (CLAUDE.md 2 rule 5). Publishing is a separate
 * permission from editing for the same reason.
 */

export async function listTestimonials(actor: Actor) {
  requirePermission(actor, "testimonials.view");

  return db.testimonial.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      authorName: true,
      authorRole: true,
      company: true,
      quote: true,
      rating: true,
      status: true,
      order: true,
      service: { select: { name: true } },
      city: { select: { name: true } },
    },
  });
}

export type TestimonialRow = Awaited<ReturnType<typeof listTestimonials>>[number];

export async function getTestimonial(actor: Actor, id: string) {
  requirePermission(actor, "testimonials.view");

  const testimonial = await db.testimonial.findUnique({
    where: { id },
    select: {
      id: true,
      authorName: true,
      authorRole: true,
      company: true,
      quote: true,
      rating: true,
      avatarId: true,
      avatar: { select: { id: true, url: true, alt: true } },
      serviceId: true,
      cityId: true,
      status: true,
      order: true,
    },
  });

  if (!testimonial) throw new NotFoundError("That testimonial does not exist.");
  return testimonial;
}

export async function createTestimonial(actor: Actor, input: TestimonialInput) {
  requirePermission(actor, "testimonials.create");
  if (input.status === "PUBLISHED") requirePermission(actor, "testimonials.publish");

  const testimonial = await withAudit(
    { actor, action: "CREATE", entityType: "Testimonial", entityId: input.authorName },
    (tx) => tx.testimonial.create({ data: input }),
  );

  revalidateTag(CACHE_TAGS.testimonials);
  return testimonial;
}

export async function updateTestimonial(actor: Actor, id: string, input: TestimonialInput) {
  requirePermission(actor, "testimonials.edit");

  const before = await getTestimonial(actor, id);
  if (input.status === "PUBLISHED" && before.status !== "PUBLISHED") {
    requirePermission(actor, "testimonials.publish");
  }

  const testimonial = await withAudit(
    { actor, action: "UPDATE", entityType: "Testimonial", entityId: id, before },
    (tx) => tx.testimonial.update({ where: { id }, data: input }),
  );

  revalidateTag(CACHE_TAGS.testimonials);
  return testimonial;
}

export async function deleteTestimonial(actor: Actor, id: string) {
  requirePermission(actor, "testimonials.delete");

  const before = await getTestimonial(actor, id);

  await withAudit(
    { actor, action: "DELETE", entityType: "Testimonial", entityId: id, before },
    (tx) => tx.testimonial.delete({ where: { id } }),
  );

  revalidateTag(CACHE_TAGS.testimonials);
}
