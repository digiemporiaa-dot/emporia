import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { PAGE_TAG } from "@/lib/services/page.service";
import { blockDefinition, isBlockType } from "@/lib/content/blocks";
import { migrateContent } from "@/lib/content/migrations";
import type { DbClient } from "@/lib/db";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
import type { Actor } from "@/lib/actor/types";

/**
 * Page version history.
 *
 * The builder writes straight to `PageSection`, so an edit is live the moment
 * it is saved and there is no undo. This is the undo: a complete snapshot of
 * what a page said, taken on publish and on demand, restorable in full.
 *
 * A snapshot is a copy, not a diff. A diff chain is only as good as its weakest
 * link, and restoring one is the moment you least want to be replaying
 * arithmetic over a year of edits.
 *
 * Versions are never taken on every save. A version per keystroke is a version
 * list nobody reads, and the point of the list is that an editor can find the
 * one from before this morning.
 */

export type SectionSnapshot = {
  type: string;
  order: number;
  name: string | null;
  isVisible: boolean;
  content: unknown;
  /** Preserved so a restored placement still points at its reusable section. */
  reusableSectionId: string | null;
};

export type PageSnapshot = {
  title: string;
  slug: string;
  internalName: string | null;
  description: string | null;
  sections: SectionSnapshot[];
};

/** Read the page as it stands. Used by both "save a version" and "before restore". */
async function snapshotOf(tx: DbClient, pageId: string): Promise<PageSnapshot> {
  const page = await tx.page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: {
      title: true,
      slug: true,
      internalName: true,
      description: true,
      sections: {
        orderBy: { order: "asc" },
        select: {
          type: true,
          order: true,
          name: true,
          isVisible: true,
          content: true,
          reusableSectionId: true,
        },
      },
    },
  });
  if (!page) throw new NotFoundError("That page does not exist.");

  return {
    title: page.title,
    slug: page.slug,
    internalName: page.internalName,
    description: page.description,
    sections: page.sections.map((section) => ({
      type: section.type,
      order: section.order,
      name: section.name,
      isVisible: section.isVisible,
      content: section.content,
      reusableSectionId: section.reusableSectionId,
    })),
  };
}

/**
 * Take a version, inside the caller's transaction.
 *
 * Exported for `setPageStatus` to call on publish, so the snapshot and the
 * publish commit together: a version recorded for a publish that then failed
 * would be a version of a state the site never served.
 *
 * The sequence number is read inside the transaction. Two publishes racing for
 * the same number collide on the unique index rather than quietly overwriting,
 * which is the correct outcome — the loser retries.
 */
export async function snapshot(
  tx: DbClient,
  pageId: string,
  actor: Actor,
  reason: string,
): Promise<{ id: string; version: number }> {
  const latest = await tx.pageVersion.findFirst({
    where: { pageId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;
  const data = await snapshotOf(tx, pageId);

  const created = await tx.pageVersion.create({
    data: {
      pageId,
      version,
      snapshot: data as unknown as InputJsonValue,
      reason,
      createdById: actor.type === "SYSTEM" ? null : actor.userId,
    },
    select: { id: true, version: true },
  });

  return created;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listVersions(actor: Actor, pageId: string, limit = 50) {
  requirePermission(actor, "pages.view");

  return db.pageVersion.findMany({
    where: { pageId },
    orderBy: { version: "desc" },
    take: limit,
    select: {
      id: true,
      version: true,
      reason: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });
}

export type VersionRow = Awaited<ReturnType<typeof listVersions>>[number];

export async function getVersion(actor: Actor, pageId: string, version: number) {
  requirePermission(actor, "pages.view");

  const row = await db.pageVersion.findFirst({
    where: { pageId, version },
    select: {
      id: true,
      version: true,
      reason: true,
      snapshot: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });
  if (!row) throw new NotFoundError("That version does not exist.");
  return { ...row, snapshot: row.snapshot as unknown as PageSnapshot };
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export type FieldChange = { field: string; from: string | null; to: string | null };

export type SectionChange = {
  kind: "added" | "removed" | "changed" | "moved";
  label: string;
  /** Position in the newer version, or in the older one for a removal. */
  position: number;
};

export type VersionDiff = {
  fields: FieldChange[];
  sections: SectionChange[];
  /** True when the two are identical, which is worth saying rather than showing a blank. */
  identical: boolean;
};

function labelFor(section: SectionSnapshot): string {
  if (section.name) return section.name;
  return isBlockType(section.type) ? blockDefinition(section.type).label : section.type;
}

/**
 * Compare two snapshots at the level an editor thinks in.
 *
 * Section by section, not character by character. A JSON text diff of a page
 * builder is unreadable — it is mostly punctuation — and the question being
 * asked is "what changed on this page", whose honest answer is a list of bands.
 *
 * Sections are matched by position, because they have no stable identity in a
 * snapshot: the builder can reorder, insert and delete, and a snapshot records
 * the result rather than the operations. A reorder therefore reads as several
 * "moved" entries, which is what happened.
 */
export function diffSnapshots(older: PageSnapshot, newer: PageSnapshot): VersionDiff {
  const fields: FieldChange[] = [];
  const compare = (field: string, from: string | null, to: string | null) => {
    if (from !== to) fields.push({ field, from, to });
  };
  compare("Title", older.title, newer.title);
  compare("Slug", older.slug, newer.slug);
  compare("Internal name", older.internalName, newer.internalName);
  compare("Description", older.description, newer.description);

  const sections: SectionChange[] = [];
  const length = Math.max(older.sections.length, newer.sections.length);

  for (let index = 0; index < length; index += 1) {
    const before = older.sections[index];
    const after = newer.sections[index];

    if (!before && after) {
      sections.push({ kind: "added", label: labelFor(after), position: index + 1 });
      continue;
    }
    if (before && !after) {
      sections.push({ kind: "removed", label: labelFor(before), position: index + 1 });
      continue;
    }
    if (!before || !after) continue;

    if (before.type !== after.type) {
      sections.push({ kind: "removed", label: labelFor(before), position: index + 1 });
      sections.push({ kind: "added", label: labelFor(after), position: index + 1 });
      continue;
    }

    const contentChanged = JSON.stringify(before.content) !== JSON.stringify(after.content);
    const chromeChanged = before.name !== after.name || before.isVisible !== after.isVisible;
    if (contentChanged || chromeChanged) {
      sections.push({ kind: "changed", label: labelFor(after), position: index + 1 });
    }
  }

  return { fields, sections, identical: fields.length === 0 && sections.length === 0 };
}

export async function compareVersions(
  actor: Actor,
  pageId: string,
  olderVersion: number,
  newerVersion: number,
): Promise<VersionDiff> {
  const [older, newer] = await Promise.all([
    getVersion(actor, pageId, olderVersion),
    getVersion(actor, pageId, newerVersion),
  ]);
  return diffSnapshots(older.snapshot, newer.snapshot);
}

/** Compare a stored version against what the page says right now. */
export async function compareWithCurrent(
  actor: Actor,
  pageId: string,
  version: number,
): Promise<VersionDiff> {
  requirePermission(actor, "pages.view");
  const stored = await getVersion(actor, pageId, version);
  const current = await snapshotOf(db, pageId);
  return diffSnapshots(stored.snapshot, current);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/** Take a version by hand, from the editor. */
export async function saveVersion(actor: Actor, pageId: string, reason: string) {
  requirePermission(actor, "pages.edit");

  const created = await db.$transaction(async (tx) => {
    const version = await snapshot(tx, pageId, actor, reason.trim() || "Saved by hand");
    await record(
      {
        actor,
        action: "CREATE",
        entityType: "PageVersion",
        entityId: pageId,
        after: { version: version.version, reason },
      },
      tx,
    );
    return version;
  });

  return created;
}

/**
 * Put a page back to what a version said.
 *
 * Three things make this safe enough to offer as a button:
 *
 * **It snapshots first.** The state being replaced becomes a version of its
 * own, so restoring the wrong one is itself undoable. Nothing here is a
 * one-way door.
 *
 * **It does not publish.** Restoring changes what the page says, never whether
 * it is live: a restore on a published page is immediately public — which is
 * already true of every edit in this builder — and a restore on a draft leaves
 * it a draft. Changing publication is `setPageStatus`, with its own permission.
 *
 * **It migrates on the way in.** A snapshot from before a block's shape changed
 * is brought forward by the same ladder the renderer uses, so an old version
 * restores as something that still renders rather than as a band that fails its
 * schema and disappears.
 *
 * The slug is deliberately *not* restored when it would collide with another
 * page: an old version's address may since have been taken, and failing the
 * whole restore over it would make history unusable.
 */
export async function restoreVersion(actor: Actor, pageId: string, version: number) {
  requirePermission(actor, "pages.edit");

  const target = await getVersion(actor, pageId, version);
  const snapshotData = target.snapshot;

  const clash = await db.page.findFirst({
    where: { slug: snapshotData.slug, id: { not: pageId } },
    select: { id: true },
  });

  const restored = await db.$transaction(async (tx) => {
    // The state being replaced, kept before anything is touched.
    await snapshot(tx, pageId, actor, `Before restoring v${version}`);

    await tx.pageSection.deleteMany({ where: { pageId } });

    if (snapshotData.sections.length > 0) {
      await tx.pageSection.createMany({
        data: snapshotData.sections.map((section, index) => ({
          pageId,
          type: section.type,
          // Renumbered rather than trusting the stored order, which may have
          // gaps from a deletion that happened before the snapshot.
          order: index,
          name: section.name,
          isVisible: section.isVisible,
          content: migrateContent(section.content, section.type) as InputJsonValue,
          reusableSectionId: section.reusableSectionId,
        })),
      });
    }

    const page = await tx.page.update({
      where: { id: pageId },
      data: {
        title: snapshotData.title,
        internalName: snapshotData.internalName,
        description: snapshotData.description,
        // Kept as it is when the old address now belongs to something else.
        ...(clash ? {} : { slug: snapshotData.slug }),
      },
      select: { id: true, slug: true, status: true },
    });

    await record(
      {
        actor,
        action: "UPDATE",
        entityType: "Page",
        entityId: pageId,
        after: { restoredFrom: version, slugRestored: !clash },
      },
      tx,
    );

    return page;
  });

  revalidateTag(PAGE_TAG);
  return { ...restored, slugKept: Boolean(clash) };
}

/**
 * Delete a version.
 *
 * Only offered to whoever can delete the page itself: history is what makes a
 * mistake recoverable, and a role that can edit should not be able to remove
 * the record of what it edited.
 */
export async function deleteVersion(actor: Actor, pageId: string, version: number) {
  requirePermission(actor, "pages.delete");

  const row = await db.pageVersion.findFirst({
    where: { pageId, version },
    select: { id: true, version: true, reason: true },
  });
  if (!row) throw new NotFoundError("That version does not exist.");

  const count = await db.pageVersion.count({ where: { pageId } });
  if (count <= 1) {
    throw new ConflictError("That is the only version of this page. Keeping it costs nothing.");
  }

  await withAudit(
    { actor, action: "DELETE", entityType: "PageVersion", entityId: pageId, before: row },
    (tx) => tx.pageVersion.delete({ where: { id: row.id } }),
  );
}
