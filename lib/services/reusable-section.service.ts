import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { paged, toSkipTake } from "@/lib/paging";
import { BLOCK_SCHEMAS, blockDefinition, isBlockType, type BlockType } from "@/lib/content/blocks";
import { slugify, uniqueSlug } from "@/lib/utils/slug";
import { PAGE_TAG } from "@/lib/services/page.service";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
import type { Actor } from "@/lib/actor/types";
import type { ReusableListInput, ReusableSectionDraftInput } from "@/lib/validation/page";
import { stampVersion } from "@/lib/content/migrations";

/**
 * Reusable sections: a band authored once and placed on many pages.
 *
 * The relationship is a reference, not a copy. A PageSection pointing at one
 * keeps a snapshot of the resolved type and content, which is what renders if
 * the reusable is later unpublished or deleted — the page degrades to its last
 * known good state instead of losing a band (docs/ARCHITECTURE.md 17.1, and
 * the same posture `parseSections` takes towards invalid content).
 *
 * That snapshot is refreshed whenever the reusable is saved, so every placement
 * updates together. Which is the point, and also the danger: this is the one
 * edit in the CMS that changes pages the editor is not looking at, so the admin
 * says how many before they save.
 */

export const REUSABLE_TAG = "reusable-sections";

const listSelect = {
  id: true,
  key: true,
  name: true,
  type: true,
  status: true,
  isGlobal: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { usages: true } },
} as const;

const detailSelect = { ...listSelect, content: true } as const;

export async function listReusableSections(actor: Actor, input: ReusableListInput) {
  requirePermission(actor, "pages.view");

  const { page, perPage, skip, take } = toSkipTake(input);
  const query = input.query?.trim();

  const where = {
    deletedAt: null,
    ...(input.status ? { status: input.status } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { key: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.reusableSection.findMany({
      where,
      // Global ones first: they are the site's standard bands and the thing
      // someone is usually looking for.
      orderBy: [{ isGlobal: "desc" }, { updatedAt: "desc" }],
      skip,
      take,
      select: listSelect,
    }),
    db.reusableSection.count({ where }),
  ]);

  return paged(rows, total, page, perPage);
}

export type ReusableSectionRow = Awaited<ReturnType<typeof listReusableSections>>["rows"][number];

export async function getReusableSection(actor: Actor, id: string) {
  requirePermission(actor, "pages.view");

  const section = await db.reusableSection.findFirst({
    where: { id, deletedAt: null },
    select: detailSelect,
  });
  if (!section) throw new NotFoundError("That reusable section does not exist.");
  return section;
}

/** Published reusable sections, for the builder's insert list. */
export async function listInsertable(actor: Actor) {
  requirePermission(actor, "pages.edit");

  return db.reusableSection.findMany({
    where: { deletedAt: null, status: "PUBLISHED" },
    orderBy: [{ isGlobal: "desc" }, { name: "asc" }],
    select: { id: true, key: true, name: true, type: true, isGlobal: true },
  });
}

function parseContent(type: BlockType, content: unknown): InputJsonValue {
  const result = BLOCK_SCHEMAS[type].safeParse(content);
  if (!result.success) {
    throw new ValidationError(
      result.error.issues[0]?.message ?? "Check the section's details.",
      result.error.flatten().fieldErrors,
    );
  }
  return stampVersion(result.data) as InputJsonValue;
}

const keyTaken = async (candidate: string): Promise<boolean> =>
  (await db.reusableSection.count({ where: { key: candidate } })) > 0;

export async function createReusableSection(actor: Actor, input: ReusableSectionDraftInput) {
  requirePermission(actor, "pages.create");

  if (!isBlockType(input.type)) throw new ValidationError("That is not a block you can add.");
  if (!slugify(input.name))
    throw new ValidationError("Give the section a name with letters in it.");

  const type: BlockType = input.type;
  const key = await uniqueSlug(input.name, keyTaken);
  const definition = blockDefinition(type);

  // Audited under the generated id rather than the key, so the row stays
  // findable by the entity it describes (see createPage for the same reason).
  const section = await db.$transaction(async (tx) => {
    const created = await tx.reusableSection.create({
      data: {
        key,
        name: input.name,
        type,
        content: parseContent(type, definition.defaults),
        status: "DRAFT",
        isGlobal: input.isGlobal,
      },
      select: detailSelect,
    });
    await record(
      {
        actor,
        action: "CREATE",
        entityType: "ReusableSection",
        entityId: created.id,
        after: { key, name: created.name, type: created.type },
      },
      tx,
    );
    return created;
  });

  revalidateTag(REUSABLE_TAG);
  return section;
}

/**
 * Save a reusable section, and push the result into every placement.
 *
 * The snapshot on each PageSection is rewritten in the same transaction, so
 * there is never a moment where some pages show the old content and some the
 * new — and no background job to fail silently.
 */
export async function updateReusableSection(
  actor: Actor,
  id: string,
  input: {
    name: string;
    status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    isGlobal: boolean;
    content: unknown;
  },
) {
  requirePermission(actor, "pages.edit");

  const before = await getReusableSection(actor, id);
  if (!isBlockType(before.type)) {
    throw new ValidationError("That section type cannot be edited here.");
  }
  const content = parseContent(before.type, input.content);

  const section = await db.$transaction(async (tx) => {
    const updated = await tx.reusableSection.update({
      where: { id },
      data: {
        name: input.name,
        status: input.status,
        isGlobal: input.isGlobal,
        content,
      },
      select: detailSelect,
    });

    // Only a published section pushes its content out. An unpublished one keeps
    // its placements on the last content that *was* published, rather than
    // pushing work-in-progress onto live pages.
    if (input.status === "PUBLISHED") {
      await tx.pageSection.updateMany({
        where: { reusableSectionId: id },
        data: { type: before.type, content },
      });
    }

    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "ReusableSection",
        entityId: id,
        before,
        after: { name: input.name, status: input.status, placements: before._count.usages },
      },
      tx,
    );

    return updated;
  });

  revalidateTag(REUSABLE_TAG);
  revalidateTag(PAGE_TAG);
  return section;
}

/**
 * Soft delete.
 *
 * Placements are detached rather than removed: the FK is SetNull and each
 * PageSection keeps the snapshot it had, so the pages carry on rendering the
 * band as an ordinary, now-independent section. Deleting a shared thing should
 * not blank a band on eleven pages.
 */
export async function deleteReusableSection(actor: Actor, id: string) {
  requirePermission(actor, "pages.delete");
  const before = await getReusableSection(actor, id);

  await db.$transaction(async (tx) => {
    await tx.pageSection.updateMany({
      where: { reusableSectionId: id },
      data: { reusableSectionId: null },
    });
    await tx.reusableSection.update({
      where: { id },
      data: { deletedAt: new Date(), status: "ARCHIVED" },
    });
    await record(
      {
        actor,
        action: "DELETE",
        entityType: "ReusableSection",
        entityId: id,
        before,
        after: { detachedPlacements: before._count.usages },
      },
      tx,
    );
  });

  revalidateTag(REUSABLE_TAG);
  revalidateTag(PAGE_TAG);
  return { detached: before._count.usages };
}

/** Where a reusable section is currently placed. */
export async function listUsages(actor: Actor, id: string) {
  requirePermission(actor, "pages.view");

  const usages = await db.pageSection.findMany({
    where: { reusableSectionId: id, page: { deletedAt: null } },
    select: {
      id: true,
      isVisible: true,
      page: { select: { id: true, title: true, slug: true, status: true } },
    },
    orderBy: { page: { title: "asc" } },
  });

  return usages;
}

/**
 * Place a published reusable section at the end of a page.
 *
 * The snapshot is written at insert time so the section renders immediately,
 * without the public query having to join through to the reusable row.
 */
export async function insertReusableSection(actor: Actor, pageId: string, reusableId: string) {
  requirePermission(actor, "pages.edit");

  const page = await db.page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { id: true },
  });
  if (!page) throw new NotFoundError("That page does not exist.");

  const reusable = await db.reusableSection.findFirst({
    where: { id: reusableId, deletedAt: null },
    select: { id: true, name: true, type: true, content: true, status: true },
  });
  if (!reusable) throw new NotFoundError("That reusable section does not exist.");
  if (reusable.status !== "PUBLISHED") {
    throw new ConflictError("Publish the reusable section before placing it on a page.");
  }

  const last = await db.pageSection.findFirst({
    where: { pageId },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const section = await withAudit(
    {
      actor,
      action: "CREATE",
      entityType: "PageSection",
      entityId: pageId,
      after: { reusableSectionId: reusableId },
    },
    (tx) =>
      tx.pageSection.create({
        data: {
          pageId,
          type: reusable.type,
          order: (last?.order ?? -1) + 1,
          content: (reusable.content ?? {}) as InputJsonValue,
          name: reusable.name,
          reusableSectionId: reusable.id,
        },
        select: { id: true },
      }),
  );

  revalidateTag(PAGE_TAG);
  return section;
}

/**
 * Break the link, keeping the content.
 *
 * The placement becomes an ordinary section on that page: further edits to the
 * reusable stop reaching it. This is how an editor makes a one-off variation
 * without either forking the shared section or editing it for everyone.
 */
export async function detachSection(actor: Actor, sectionId: string) {
  requirePermission(actor, "pages.edit");

  const before = await db.pageSection.findFirst({
    where: { id: sectionId, page: { deletedAt: null } },
    select: { id: true, pageId: true, reusableSectionId: true },
  });
  if (!before) throw new NotFoundError("That section does not exist.");
  if (!before.reusableSectionId) {
    throw new ConflictError("That section is not linked to a reusable section.");
  }

  await withAudit(
    { actor, action: "UPDATE", entityType: "PageSection", entityId: sectionId, before },
    (tx) => tx.pageSection.update({ where: { id: sectionId }, data: { reusableSectionId: null } }),
  );

  revalidateTag(PAGE_TAG);
  return { pageId: before.pageId };
}
