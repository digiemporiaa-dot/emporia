import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { paged, toSkipTake } from "@/lib/paging";
import { isReservedSlug, slugify, uniqueSlug } from "@/lib/utils/slug";
import { BLOCK_SCHEMAS, blockDefinition, isBlockType, type BlockType } from "@/lib/content/blocks";
import type { Actor } from "@/lib/actor/types";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
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

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const sectionSelect = {
  id: true,
  pageId: true,
  type: true,
  order: true,
  content: true,
  name: true,
  isVisible: true,
  reusableSectionId: true,
} as const;

/**
 * Validate a block's content against its own schema.
 *
 * Content arrives as JSON from the builder, so it is parsed rather than
 * trusted, and the parsed value — not the input — is what gets stored. That
 * strips unknown keys and applies the schema's defaults, so a section row can
 * never hold a shape the renderer has not agreed to.
 */
function parseBlockContent(type: BlockType, content: unknown): InputJsonValue {
  const result = BLOCK_SCHEMAS[type].safeParse(content);
  if (!result.success) {
    const fieldErrors = result.error.flatten().fieldErrors;
    throw new ValidationError(
      result.error.issues[0]?.message ?? "Check the section's details.",
      fieldErrors,
    );
  }
  return result.data as InputJsonValue;
}

/** Load a section and its page, refusing one that belongs to a deleted page. */
async function getSectionOr404(id: string) {
  const section = await db.pageSection.findFirst({
    where: { id, page: { deletedAt: null } },
    select: sectionSelect,
  });
  if (!section) throw new NotFoundError("That section does not exist.");
  return section;
}

/**
 * Add a block to the end of a page.
 *
 * The block starts from its library defaults, which are already valid, so a
 * newly added section renders immediately instead of showing an error the
 * editor has to clear before they can see what they added.
 */
export async function addSection(actor: Actor, pageId: string, type: string) {
  requirePermission(actor, "pages.edit");
  await getPage(actor, pageId);

  if (!isBlockType(type)) {
    throw new ValidationError("That is not a block you can add.");
  }

  const last = await db.pageSection.findFirst({
    where: { pageId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const definition = blockDefinition(type);
  const content = parseBlockContent(type, definition.defaults);

  const section = await withAudit(
    { actor, action: "CREATE", entityType: "PageSection", entityId: pageId, after: { type } },
    (tx) =>
      tx.pageSection.create({
        data: {
          pageId,
          type,
          order: (last?.order ?? -1) + 1,
          content,
          name: definition.label,
        },
        select: sectionSelect,
      }),
  );

  revalidateTag(PAGE_TAG);
  return section;
}

export async function updateSection(
  actor: Actor,
  id: string,
  input: { content: unknown; name?: string | null },
) {
  requirePermission(actor, "pages.edit");

  const before = await getSectionOr404(id);
  if (!isBlockType(before.type)) {
    // The bespoke bands (hero, legal, and the rest) are not builder blocks and
    // have no editor. Refusing here means the builder cannot corrupt one by
    // saving a shape it invented for it.
    throw new ValidationError("That section type cannot be edited in the builder.");
  }

  const content = parseBlockContent(before.type, input.content);

  const section = await withAudit(
    { actor, action: "UPDATE", entityType: "PageSection", entityId: id, before },
    (tx) =>
      tx.pageSection.update({
        where: { id },
        data: {
          content,
          ...(input.name === undefined ? {} : { name: input.name || null }),
        },
        select: sectionSelect,
      }),
  );

  revalidateTag(PAGE_TAG);
  return section;
}

/** Copy a section in place, directly beneath the one it came from. */
export async function duplicateSection(actor: Actor, id: string) {
  requirePermission(actor, "pages.edit");
  const source = await getSectionOr404(id);

  const created = await db.$transaction(async (tx) => {
    // Everything after the source shifts down first, so the copy lands next to
    // its original rather than at the end of the page.
    await tx.pageSection.updateMany({
      where: { pageId: source.pageId, order: { gt: source.order } },
      data: { order: { increment: 1 } },
    });

    const copy = await tx.pageSection.create({
      data: {
        pageId: source.pageId,
        type: source.type,
        order: source.order + 1,
        content: source.content ?? {},
        name: source.name,
        isVisible: source.isVisible,
        reusableSectionId: source.reusableSectionId,
      },
      select: sectionSelect,
    });

    await record(
      {
        actor,
        action: "CREATE",
        entityType: "PageSection",
        entityId: copy.id,
        after: { duplicatedFrom: source.id },
      },
      tx,
    );

    return copy;
  });

  revalidateTag(PAGE_TAG);
  return created;
}

/**
 * Hide or show a section.
 *
 * Distinct from deleting: the section keeps its content and its position, and
 * simply stops reaching the public page.
 */
export async function setSectionVisible(actor: Actor, id: string, isVisible: boolean) {
  requirePermission(actor, "pages.edit");
  const before = await getSectionOr404(id);

  const section = await withAudit(
    { actor, action: "UPDATE", entityType: "PageSection", entityId: id, before },
    (tx) => tx.pageSection.update({ where: { id }, data: { isVisible }, select: sectionSelect }),
  );

  revalidateTag(PAGE_TAG);
  return section;
}

/**
 * Remove a section, closing the gap it leaves.
 *
 * Hard delete, unlike a page: a section has no URL of its own and nothing links
 * to it, so there is no history to preserve beyond the audit row — which
 * carries its content.
 */
export async function deleteSection(actor: Actor, id: string) {
  requirePermission(actor, "pages.edit");
  const before = await getSectionOr404(id);

  await db.$transaction(async (tx) => {
    await tx.pageSection.delete({ where: { id } });
    await tx.pageSection.updateMany({
      where: { pageId: before.pageId, order: { gt: before.order } },
      data: { order: { decrement: 1 } },
    });
    await record(
      { actor, action: "DELETE", entityType: "PageSection", entityId: id, before },
      tx,
    );
  });

  revalidateTag(PAGE_TAG);
  return { pageId: before.pageId };
}
