import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { CACHE_TAGS } from "@/lib/content/queries";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "@/lib/actor/types";
import type { FaqInput } from "@/lib/validation/content";

/**
 * FAQs, attached to a service, a city or a package.
 *
 * The model already existed and already had four optional owners, but the only
 * editor was the one inside a service-city page — so an FAQ for a *service*, a
 * *city* or a *package* could not be written at all. This is that editor,
 * generalised.
 *
 * FAQs attached to a service-city page keep their own editor on that page,
 * where they belong next to the rest of the local content; this screen leaves
 * them alone rather than offering a second way to edit the same rows.
 */

export type FaqScope = { serviceId?: string; cityId?: string; packageId?: string };

/** Only rows this screen owns: the service-city ones stay on their own page. */
const STANDALONE: Prisma.FAQWhereInput = { serviceCityPageId: null };

export async function listFaqs(actor: Actor, scope?: FaqScope) {
  requirePermission(actor, "faqs.view");

  return db.fAQ.findMany({
    where: {
      ...STANDALONE,
      ...(scope?.serviceId ? { serviceId: scope.serviceId } : {}),
      ...(scope?.cityId ? { cityId: scope.cityId } : {}),
      ...(scope?.packageId ? { packageId: scope.packageId } : {}),
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      question: true,
      answer: true,
      order: true,
      isActive: true,
      service: { select: { name: true } },
      city: { select: { name: true } },
      package: { select: { name: true } },
    },
  });
}

export type FaqRow = Awaited<ReturnType<typeof listFaqs>>[number];

export async function getFaq(actor: Actor, id: string) {
  requirePermission(actor, "faqs.view");

  const faq = await db.fAQ.findFirst({
    where: { id, ...STANDALONE },
    select: {
      id: true,
      question: true,
      answer: true,
      serviceId: true,
      cityId: true,
      packageId: true,
      order: true,
      isActive: true,
    },
  });

  if (!faq) throw new NotFoundError("That FAQ does not exist.");
  return faq;
}

/**
 * An FAQ answers a question *about* something.
 *
 * Left unattached it would render nowhere, which reads to an editor as the save
 * having failed. Better to say so than to store a row nothing will ever show.
 */
function assertAttached(input: FaqInput): void {
  if (input.serviceId || input.cityId || input.packageId) return;
  throw new ValidationError("Attach this FAQ to a service, a city or a package.", {
    serviceId: ["Choose at least one of service, city or package."],
  });
}

export async function createFaq(actor: Actor, input: FaqInput) {
  requirePermission(actor, "faqs.create");
  assertAttached(input);

  const faq = await withAudit(
    { actor, action: "CREATE", entityType: "FAQ", entityId: input.question.slice(0, 80) },
    (tx) => tx.fAQ.create({ data: input }),
  );

  revalidateTag(CACHE_TAGS.services);
  revalidateTag("cities");
  revalidateTag(CACHE_TAGS.packages);
  return faq;
}

export async function updateFaq(actor: Actor, id: string, input: FaqInput) {
  requirePermission(actor, "faqs.edit");
  assertAttached(input);

  const before = await getFaq(actor, id);

  const faq = await withAudit(
    { actor, action: "UPDATE", entityType: "FAQ", entityId: id, before },
    (tx) => tx.fAQ.update({ where: { id }, data: input }),
  );

  revalidateTag(CACHE_TAGS.services);
  revalidateTag("cities");
  revalidateTag(CACHE_TAGS.packages);
  return faq;
}

/**
 * Switch an FAQ on or off, without touching anything else.
 *
 * An FAQ has no draft state — it is shown or it is not — so this is an edit,
 * gated on `faqs.edit`, rather than an act of publication. Separate from
 * `updateFaq` because a bulk action must not have to reconstruct the whole
 * record to change one flag.
 */
export async function setFaqActive(actor: Actor, id: string, isActive: boolean) {
  requirePermission(actor, "faqs.edit");

  const before = await getFaq(actor, id);

  const faq = await withAudit(
    {
      actor,
      action: isActive ? "PUBLISH" : "UNPUBLISH",
      entityType: "FAQ",
      entityId: id,
      before,
    },
    (tx) => tx.fAQ.update({ where: { id }, data: { isActive } }),
  );

  // The same three surfaces `updateFaq` busts: an FAQ is attached to a service,
  // a city or a package, and any of them may now show or hide it.
  revalidateTag(CACHE_TAGS.services);
  revalidateTag("cities");
  revalidateTag(CACHE_TAGS.packages);
  return faq;
}

export async function deleteFaq(actor: Actor, id: string) {
  requirePermission(actor, "faqs.delete");

  const before = await getFaq(actor, id);

  await withAudit({ actor, action: "DELETE", entityType: "FAQ", entityId: id, before }, (tx) =>
    tx.fAQ.delete({ where: { id } }),
  );

  revalidateTag(CACHE_TAGS.services);
  revalidateTag("cities");
  revalidateTag(CACHE_TAGS.packages);
}
