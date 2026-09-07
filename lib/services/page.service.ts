import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { paged, toSkipTake } from "@/lib/paging";
import { isReservedSlug, slugify, uniqueSlug } from "@/lib/utils/slug";
import type { Actor } from "@/lib/actor/types";
import type {
  PageDraftInput,
  PageInput,
  PageListInput,
  SectionOrderInput,
} from "@/lib/validation/page";

/**
 * Website page CMS.
 *
 * Every mutation checks a permission before doing work and writes an audit row
 * in the same transaction as the change (CLAUDE.md 2 rule 2, 11). Permissions
 * are the `pages.*` namespace, kept separate from `content.*`, which belongs to
 * the content calendar.
 *
 * Deletion is soft. A page's slug is a live URL, so removing the row would
 * break inbound links and throw away the section history; `deletedAt` is set
 * and every read path filters on it.
 */

export const PAGE_TAG = "pages";

const listSelect = {
  id: true,
  slug: true,
  title: true,
  internalName: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
  createdAt: true,
  _count: { select: { sections: true } },
} as const;

const detailSelect = {
  ...listSelect,
  description: true,
  seoId: true,
  sections: {
    orderBy: { order: "asc" as const },
    select: {
      id: true,
      type: true,
      order: true,
      content: true,
      name: true,
      isVisible: true,
      reusableSectionId: true,
    },
  },
} as const;

export async function listPages(actor: Actor, input: PageListInput) {
  requirePermission(actor, "pages.view");

  const { page, perPage, skip, take } = toSkipTake(input);
  const query = input.query?.trim();

  const where = {
    deletedAt: input.view === "deleted" ? { not: null } : null,
    ...(input.status ? { status: input.status } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" as const } },
            { slug: { contains: query, mode: "insensitive" as const } },
            { internalName: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.page.findMany({ where, orderBy: { updatedAt: "desc" }, skip, take, select: listSelect }),
    db.page.count({ where }),
  ]);

  return paged(rows, total, page, perPage);
}

export type PageRow = Awaited<ReturnType<typeof listPages>>["rows"][number];

export async function getPage(actor: Actor, id: string) {
  requirePermission(actor, "pages.view");

  const page = await db.page.findFirst({ where: { id, deletedAt: null }, select: detailSelect });
  if (!page) throw new NotFoundError("That page does not exist.");
  return page;
}

/**
 * A soft-deleted page still owns its slug — restoring it must not collide with
 * something created in the meantime — so the check deliberately ignores
 * `deletedAt`.
 *
 * `currentSlug` is the slug this page already has. A reserved slug is refused
 * when moving *onto* it, but never when a page is simply keeping the one it
 * holds: `home`, `about`, `careers` and the legal pages are CMS pages whose
 * sections the bespoke routes read by exactly that slug. Without this, editing
 * any of them would fail on a field the editor never touched.
 */
async function assertSlugFree(
  slug: string,
  excludeId?: string,
  currentSlug?: string,
): Promise<void> {
  // Both conflicts here are about the slug, and say so, so the form can put
  // the message on that field instead of only in a banner at the top.
  if (slug !== currentSlug && isReservedSlug(slug)) {
    const message = "That address is used by a built-in page. Choose another slug.";
    throw new ConflictError(message, { slug: [message] });
  }
  const clash = await db.page.findFirst({
    where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    const message = "Another page already uses that slug.";
    throw new ConflictError(message, { slug: [message] });
  }
}

const slugTaken = async (candidate: string): Promise<boolean> =>
  (await db.page.count({ where: { slug: candidate } })) > 0;

/** Create an empty draft. Sections are added in the builder, not here. */
export async function createPage(actor: Actor, input: PageDraftInput) {
  requirePermission(actor, "pages.create");

  const slug = input.slug ?? (await uniqueSlug(input.title, slugTaken));
  await assertSlugFree(slug);

  const page = await withAudit(
    { actor, action: "CREATE", entityType: "Page", entityId: slug },
    (tx) => tx.page.create({ data: { title: input.title, slug, status: "DRAFT" } }),
  );

  revalidateTag(PAGE_TAG);
  return page;
}

export async function updatePage(actor: Actor, id: string, input: PageInput) {
  requirePermission(actor, "pages.edit");

  const before = await getPage(actor, id);
  await assertSlugFree(input.slug, id, before.slug);

  // Changing status through this path is an edit, not a publish. Reaching
  // PUBLISHED goes through setPageStatus, which requires `pages.publish`.
  const page = await withAudit(
    { actor, action: "UPDATE", entityType: "Page", entityId: id, before },
    (tx) =>
      tx.page.update({
        where: { id },
        data: {
          title: input.title,
          slug: input.slug,
          internalName: input.internalName ?? null,
          description: input.description ?? null,
        },
      }),
  );

  revalidateTag(PAGE_TAG);
  return page;
}

/**
 * Publish, unpublish or archive.
 *
 * `publishedAt` is stamped once, the first time a page goes live, and never
 * rewritten — unpublishing to fix a typo should not make the page look new.
 */
export async function setPageStatus(
  actor: Actor,
  id: string,
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED",
) {
  requirePermission(actor, status === "PUBLISHED" ? "pages.publish" : "pages.edit");

  const before = await getPage(actor, id);

  const page = await withAudit(
    {
      actor,
      action: status === "PUBLISHED" ? "PUBLISH" : "UNPUBLISH",
      entityType: "Page",
      entityId: id,
      before,
    },
    (tx) =>
      tx.page.update({
        where: { id },
        data: {
          status,
          ...(status === "PUBLISHED" && !before.publishedAt ? { publishedAt: new Date() } : {}),
        },
      }),
  );

  revalidateTag(PAGE_TAG);
  return page;
}

/**
 * Copy a page and its sections into a new draft.
 *
 * The copy is always a DRAFT regardless of the source's status: duplicating a
 * live page should never put a second live page on the site by accident. SEO is
 * deliberately not copied — two pages sharing a canonical and meta title is the
 * defect the duplicate button would otherwise mass-produce.
 */
export async function duplicatePage(actor: Actor, id: string) {
  requirePermission(actor, "pages.create");

  const source = await getPage(actor, id);
  const slug = await uniqueSlug(`${source.slug}-copy`, slugTaken);

  const created = await db.$transaction(async (tx) => {
    const copy = await tx.page.create({
      data: {
        title: `${source.title} (copy)`,
        slug,
        internalName: source.internalName,
        description: source.description,
        status: "DRAFT",
        sections: {
          create: source.sections.map((section) => ({
            type: section.type,
            order: section.order,
            content: section.content ?? {},
            name: section.name,
            isVisible: section.isVisible,
            reusableSectionId: section.reusableSectionId,
          })),
        },
      },
      select: { id: true, slug: true, title: true },
    });

    await record(
      {
        actor,
        action: "CREATE",
        entityType: "Page",
        entityId: copy.id,
        after: { duplicatedFrom: source.id, slug: copy.slug },
      },
      tx,
    );

    return copy;
  });

  revalidateTag(PAGE_TAG);
  return created;
}

/** Soft delete. The row and its sections stay; nothing reads them again. */
export async function deletePage(actor: Actor, id: string) {
  requirePermission(actor, "pages.delete");

  const before = await getPage(actor, id);

  await withAudit(
    { actor, action: "DELETE", entityType: "Page", entityId: id, before },
    (tx) => tx.page.update({ where: { id }, data: { deletedAt: new Date(), status: "ARCHIVED" } }),
  );

  revalidateTag(PAGE_TAG);
}

export async function restorePage(actor: Actor, id: string) {
  requirePermission(actor, "pages.delete");

  const page = await db.page.findUnique({ where: { id }, select: { id: true, slug: true } });
  if (!page) throw new NotFoundError("That page does not exist.");

  // Something else may have claimed the slug while this page was in the bin.
  // Its own slug is not held against it, reserved or not.
  await assertSlugFree(page.slug, id, page.slug);

  const restored = await withAudit(
    { actor, action: "RESTORE", entityType: "Page", entityId: id },
    (tx) => tx.page.update({ where: { id }, data: { deletedAt: null, status: "DRAFT" } }),
  );

  revalidateTag(PAGE_TAG);
  return restored;
}

/**
 * Persist a new section order.
 *
 * Written in one transaction so a failed drag cannot leave the page with two
 * sections claiming position 3.
 */
export async function reorderSections(actor: Actor, pageId: string, ordered: SectionOrderInput) {
  requirePermission(actor, "pages.edit");
  await getPage(actor, pageId);

  await db.$transaction(async (tx) => {
    for (const item of ordered) {
      // Scoped by pageId so an id from another page cannot be reordered in.
      await tx.pageSection.updateMany({
        where: { id: item.id, pageId },
        data: { order: item.order },
      });
    }
    await record(
      { actor, action: "UPDATE", entityType: "Page", entityId: pageId, after: { ordered } },
      tx,
    );
  });

  revalidateTag(PAGE_TAG);
}

/** Suggest a slug for a title, without creating anything. */
export async function suggestSlug(actor: Actor, title: string): Promise<string> {
  requirePermission(actor, "pages.create");
  if (!slugify(title)) return "";
  return uniqueSlug(title, slugTaken);
}
