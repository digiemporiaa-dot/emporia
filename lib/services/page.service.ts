import "server-only";
import { randomBytes } from "node:crypto";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { paged, toSkipTake } from "@/lib/paging";
import { isReservedSlug, slugify, uniqueSlug } from "@/lib/utils/slug";
import { BLOCK_SCHEMAS, blockDefinition, isBlockType, type BlockType } from "@/lib/content/blocks";
import { stampVersion } from "@/lib/content/migrations";
import { snapshot } from "@/lib/services/page-version.service";
import type { Actor } from "@/lib/actor/types";
import type { PageWorkflow } from "@/generated/prisma/enums";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
import type { PageSeoInput } from "@/lib/validation/seo";
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
  workflow: true,
  publishedAt: true,
  updatedAt: true,
  createdAt: true,
  _count: { select: { sections: true } },
} as const;

const detailSelect = {
  ...listSelect,
  description: true,
  reviewNote: true,
  deletedAt: true,
  previewToken: true,
  seoId: true,
  seo: {
    select: {
      id: true,
      metaTitle: true,
      metaDescription: true,
      canonical: true,
      ogTitle: true,
      ogDescription: true,
      ogImageId: true,
      ogImageAlt: true,
      twitterTitle: true,
      twitterDescription: true,
      twitterImageId: true,
      robotsIndex: true,
      robotsFollow: true,
      schemaType: true,
    },
  },
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

  // Audited under the generated id, not the slug: `withAudit` fixes entityId
  // before the row exists, and a page's slug is mutable — keying its history to
  // one makes the create unfindable by id and stale the moment it is renamed.
  const page = await db.$transaction(async (tx) => {
    const created = await tx.page.create({
      data: { title: input.title, slug, status: "DRAFT" },
    });
    await record(
      { actor, action: "CREATE", entityType: "Page", entityId: created.id, after: created },
      tx,
    );
    return created;
  });

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
    async (tx) => {
      // Snapshotted inside the transaction, so a version is only recorded for a
      // publish that actually happened — a version of a state the site never
      // served would be worse than no version.
      if (status === "PUBLISHED") await snapshot(tx, id, actor, "Published");

      return tx.page.update({
        where: { id },
        data: {
          status,
          ...(status === "PUBLISHED" && !before.publishedAt ? { publishedAt: new Date() } : {}),
        },
      });
    },
  );

  revalidateTag(PAGE_TAG);
  return page;
}

/**
 * Editorial workflow.
 *
 * `status` answers "is this live"; `workflow` answers "is the draft ready".
 * Separate fields because they are separate questions with separate
 * permissions: an editor moves a page through review, a publisher puts it on
 * the site.
 *
 * The transitions are deliberately few. Anyone with `pages.edit` can submit
 * work for review or pull it back; deciding on it — approving, or asking for
 * changes — needs `pages.publish`, because approving is the judgement that
 * precedes publishing and should not be self-service.
 *
 * **What this does not do.** The builder writes straight to `PageSection`, so a
 * published page's edits are live the moment they are saved. Review therefore
 * gates the *first* publish and any republish, not the content of a page that
 * is already out. Making review gate live content needs draft/published content
 * separation, which is a change of its own and is not pretended at here
 * (CLAUDE.md 15 rule 5).
 */
const WORKFLOW_TRANSITIONS: Record<PageWorkflow, readonly PageWorkflow[]> = {
  DRAFT: ["IN_REVIEW"],
  IN_REVIEW: ["APPROVED", "CHANGES_REQUESTED", "DRAFT"],
  CHANGES_REQUESTED: ["IN_REVIEW", "DRAFT"],
  APPROVED: ["DRAFT", "IN_REVIEW"],
};

/** Deciding on a review is a publisher's call; asking for one is an editor's. */
const DECISIONS: ReadonlySet<PageWorkflow> = new Set<PageWorkflow>([
  "APPROVED",
  "CHANGES_REQUESTED",
]);

export async function setPageWorkflow(
  actor: Actor,
  id: string,
  workflow: PageWorkflow,
  note?: string | null,
) {
  requirePermission(actor, DECISIONS.has(workflow) ? "pages.publish" : "pages.edit");

  const before = await getPage(actor, id);

  if (before.workflow === workflow) {
    throw new ConflictError(`This page is already ${WORKFLOW_LABELS[workflow].toLowerCase()}.`);
  }
  if (!WORKFLOW_TRANSITIONS[before.workflow].includes(workflow)) {
    throw new ConflictError(
      `A page that is ${WORKFLOW_LABELS[before.workflow].toLowerCase()} cannot go straight to ${WORKFLOW_LABELS[workflow].toLowerCase()}.`,
    );
  }

  const page = await withAudit(
    { actor, action: "UPDATE", entityType: "Page workflow", entityId: id, before },
    (tx) =>
      tx.page.update({
        where: { id },
        data: {
          workflow,
          // A note belongs to the decision that carried it. Submitting for
          // review again clears the last reviewer's note rather than leaving it
          // hanging over work that has since changed.
          reviewNote: workflow === "IN_REVIEW" ? null : note?.trim() || null,
        },
      }),
  );

  return page;
}

export const WORKFLOW_LABELS: Record<PageWorkflow, string> = {
  DRAFT: "In progress",
  IN_REVIEW: "In review",
  CHANGES_REQUESTED: "Changes requested",
  APPROVED: "Approved",
};

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

  await withAudit({ actor, action: "DELETE", entityType: "Page", entityId: id, before }, (tx) =>
    tx.page.update({ where: { id }, data: { deletedAt: new Date(), status: "ARCHIVED" } }),
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
  return stampVersion(result.data) as InputJsonValue;
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

/**
 * Change a section's block type, keeping what the new type also accepts.
 *
 * Every block shares a `band`, and most share a heading, an eyebrow, a body and
 * a grid, so converting a Benefits band into Image cards should not throw away
 * the copy and the layout someone already set. What the new type has no field
 * for is dropped — silently, because there is nowhere to put it, and the
 * builder says so before the change is made.
 *
 * A section linked to a reusable section is refused: its type is decided where
 * it is authored, and changing the copy here would be overwritten by the next
 * save of the original.
 */
export async function changeSectionType(actor: Actor, id: string, type: string) {
  requirePermission(actor, "pages.edit");

  const before = await getSectionOr404(id);
  if (!isBlockType(type)) {
    throw new ValidationError("That is not a block you can change to.");
  }
  if (before.reusableSectionId) {
    throw new ValidationError(
      "This section is linked to a reusable section. Unlink it before changing its type.",
    );
  }
  const previous = before.type;
  if (!isBlockType(previous)) {
    throw new ValidationError("That section type cannot be edited in the builder.");
  }

  const definition = blockDefinition(type);
  const current = (before.content ?? {}) as Record<string, unknown>;
  const shared = Object.keys(BLOCK_SCHEMAS[type].shape);

  const carried: Record<string, unknown> = { ...definition.defaults };
  for (const key of shared) {
    if (key in current && current[key] !== undefined) carried[key] = current[key];
  }

  // A carried value can still be wrong for the new type — `items` of one shape
  // where another is expected. Falling back to the defaults means the change
  // always succeeds and always leaves a renderable section, rather than failing
  // with a validation error about a field the editor never touched.
  const parsed = BLOCK_SCHEMAS[type].safeParse(carried);
  const content = (
    parsed.success ? parsed.data : parseBlockContent(type, definition.defaults)
  ) as InputJsonValue;

  const section = await withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "PageSection",
      entityId: id,
      before,
      after: { type },
    },
    (tx) =>
      tx.pageSection.update({
        where: { id },
        data: {
          type,
          content,
          // The old label named the old block; keep a custom one, replace the
          // one that was just the block's name.
          ...(before.name === blockDefinition(previous).label ? { name: definition.label } : {}),
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
    await record({ actor, action: "DELETE", entityType: "PageSection", entityId: id, before }, tx);
  });

  revalidateTag(PAGE_TAG);
  return { pageId: before.pageId };
}

// ---------------------------------------------------------------------------
// SEO and preview
// ---------------------------------------------------------------------------

/**
 * Save a page's SEO record, creating it on first save.
 *
 * `seo.edit` rather than `pages.edit`: SEO is its own responsibility in the
 * permission catalogue, and a marketing manager who may tune metadata is not
 * necessarily someone who may rewrite the page's content.
 */
export async function updatePageSeo(actor: Actor, pageId: string, input: PageSeoInput) {
  requirePermission(actor, "seo.edit");

  const before = await db.page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { id: true, seoId: true, seo: { select: { id: true } } },
  });
  if (!before) throw new NotFoundError("That page does not exist.");

  const data = {
    metaTitle: input.metaTitle,
    metaDescription: input.metaDescription,
    canonical: input.canonical,
    ogTitle: input.ogTitle,
    ogDescription: input.ogDescription,
    ogImageId: input.ogImageId,
    ogImageAlt: input.ogImageAlt,
    twitterTitle: input.twitterTitle,
    twitterDescription: input.twitterDescription,
    twitterImageId: input.twitterImageId,
    robotsIndex: input.robotsIndex,
    robotsFollow: input.robotsFollow,
    schemaType: input.schemaType,
  };

  await withAudit(
    { actor, action: "UPDATE", entityType: "PageSeo", entityId: pageId, before },
    async (tx) => {
      if (before.seoId) {
        return tx.seo.update({ where: { id: before.seoId }, data });
      }
      // The Seo row is created first and linked by id: Prisma will not accept a
      // nested relation create alongside scalar foreign keys in the same call.
      const seo = await tx.seo.create({ data });
      return tx.page.update({ where: { id: pageId }, data: { seoId: seo.id } });
    },
  );

  revalidateTag(PAGE_TAG);
  return getPage(actor, pageId);
}

/**
 * Mint (or rotate) a shareable draft-preview link.
 *
 * 32 bytes from a CSPRNG, base64url — long enough that guessing is not a
 * strategy. Rotating replaces the old token, which is how a shared link is
 * revoked from someone who should no longer have it.
 */
export async function issuePreviewToken(actor: Actor, pageId: string) {
  requirePermission(actor, "pages.edit");
  await getPage(actor, pageId);

  const token = randomBytes(32).toString("base64url");

  await withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "Page",
      entityId: pageId,
      after: { previewLink: "issued" },
    },
    (tx) => tx.page.update({ where: { id: pageId }, data: { previewToken: token } }),
  );

  return token;
}

export async function revokePreviewToken(actor: Actor, pageId: string) {
  requirePermission(actor, "pages.edit");
  await getPage(actor, pageId);

  await withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "Page",
      entityId: pageId,
      after: { previewLink: "revoked" },
    },
    (tx) => tx.page.update({ where: { id: pageId }, data: { previewToken: null } }),
  );
}

/**
 * Resolve a preview token to its page.
 *
 * Unauthenticated by design — that is what the link is for — so the token is
 * the entire credential and this deliberately returns nothing for a deleted
 * page. A page that is already published is still served here rather than
 * redirected: the point of the link is to show the current draft state.
 */
export async function getPageByPreviewToken(token: string) {
  if (!token || token.length < 20) return null;

  return db.page.findFirst({
    where: { previewToken: token, deletedAt: null },
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      sections: {
        where: { isVisible: true },
        orderBy: { order: "asc" },
        select: { id: true, type: true, order: true, content: true },
      },
    },
  });
}

/**
 * Recent changes to a page, for the audit trail in the editor.
 *
 * Reads the AuditLog rows every mutation in this service already writes, so
 * the trail cannot drift from what actually happened — there is no second
 * bookkeeping path to forget to update. Includes rows for the page's SEO,
 * which are recorded under their own entity type.
 */
export async function listPageAudit(actor: Actor, pageId: string, limit = 20) {
  requirePermission(actor, "audit.view");

  const sectionIds = (
    await db.pageSection.findMany({ where: { pageId }, select: { id: true } })
  ).map((section) => section.id);

  return db.auditLog.findMany({
    where: {
      OR: [
        { entityType: "Page", entityId: pageId },
        { entityType: "PageSeo", entityId: pageId },
        { entityType: "PageSection", entityId: { in: [pageId, ...sectionIds] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      entityType: true,
      createdAt: true,
      actor: { select: { name: true } },
    },
  });
}
