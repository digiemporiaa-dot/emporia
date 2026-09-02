import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { storage } from "@/lib/storage";
import { objectKey, safeFilename } from "@/lib/media/keys";
import { sniff, SNIFF_BYTES } from "@/lib/media/sniff";
import { allowedTypeFor } from "@/lib/media/types";
import { decodeIntent, encodeIntent, INTENT_TTL_SECONDS } from "@/lib/media/intent";
import type { Actor } from "@/lib/actor/types";
import type { Prisma } from "@/generated/prisma/client";
import type {
  FolderInput,
  MediaListParamsInput,
  MediaUpdateInput,
  PresignInput,
} from "@/lib/validation/media";

/**
 * The media library.
 *
 * Uploading is two steps with the bytes never passing through this server:
 *
 *   1. `presign` checks the permission, the claimed type and the size, mints an
 *      opaque object key and returns a short-lived presigned PUT plus a signed
 *      intent describing exactly what was agreed to.
 *   2. `confirm` verifies the intent, checks the object that actually landed —
 *      its size against the signed size, and its leading bytes against the
 *      claimed type — and only then writes the Media row.
 *
 * A file whose bytes disagree with its claimed type is deleted from the bucket
 * and refused. That is the phase 11 exit criterion, and it is why nothing here
 * trusts a filename, an extension or a client-sent Content-Type
 * (CLAUDE.md 11).
 */

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function presign(actor: Actor, input: PresignInput) {
  requirePermission(actor, "media.upload");

  const type = allowedTypeFor(input.contentType);
  if (!type) throw new ValidationError("That file type is not supported.");

  // Per-type cap, not just the global one: a 200 MB "PNG" is refused here.
  if (input.size > type.maxBytes) {
    const mb = Math.round(type.maxBytes / (1024 * 1024));
    throw new ValidationError(`A ${type.extension.toUpperCase()} may be at most ${mb} MB.`);
  }

  if (input.folderId) {
    const folder = await db.mediaFolder.findUnique({
      where: { id: input.folderId },
      select: { id: true },
    });
    if (!folder) throw new ValidationError("That folder does not exist.");
  }

  if (input.replacesId) {
    requirePermission(actor, "media.edit");
    const existing = await db.media.findFirst({
      where: { id: input.replacesId, deletedAt: null },
      select: { id: true, type: true },
    });
    if (!existing) throw new ValidationError("That file does not exist.");
    if (existing.type !== type.kind) {
      throw new ValidationError("A new version must be the same kind of file.");
    }
  }

  const key = objectKey(type.mime);
  const upload = await storage().presignUpload({
    key,
    contentType: type.mime,
    size: input.size,
  });

  const intent = encodeIntent({
    key,
    mime: type.mime,
    size: input.size,
    filename: safeFilename(input.filename, type.mime),
    alt: input.alt ?? null,
    folderId: input.folderId ?? null,
    replacesId: input.replacesId ?? null,
    userId: actor.userId,
    exp: Math.floor(Date.now() / 1000) + INTENT_TTL_SECONDS,
  });

  return {
    uploadId: intent,
    url: upload.url,
    headers: upload.headers,
    expiresIn: upload.expiresIn,
  };
}

/**
 * Verify what actually landed in the bucket, then record it.
 *
 * Everything is checked against the signed intent rather than against anything
 * the caller sends now.
 */
export async function confirm(actor: Actor, uploadId: string) {
  requirePermission(actor, "media.upload");

  const intent = decodeIntent(uploadId);

  // An intent signed for someone else is not usable, even though it is valid.
  if (intent.userId !== actor.userId) {
    throw new ValidationError("That upload was not started by you.");
  }

  const type = allowedTypeFor(intent.mime);
  if (!type) throw new ValidationError("That file type is not supported.");

  const store = storage();
  const head = await store.head(intent.key);
  if (!head) throw new ValidationError("That file did not finish uploading. Try again.");

  // The size was signed into the presigned URL, so a mismatch means something
  // other than the agreed object is sitting there.
  if (head.size !== intent.size) {
    await store.delete(intent.key);
    throw new ValidationError("That upload does not match what was agreed. Try again.");
  }

  if (head.size > type.maxBytes) {
    await store.delete(intent.key);
    throw new ValidationError("That file is too large.");
  }

  const bytes = await store.readRange(intent.key, SNIFF_BYTES);
  if (!bytes) {
    throw new ValidationError("That file could not be read back. Try again.");
  }

  const verdict = sniff(bytes, intent.mime);
  if (!verdict.ok) {
    // Refused *and* removed: an object nothing points at is rubbish in the
    // bucket, and a rejected file has no business being reachable by URL.
    await store.delete(intent.key);
    await record({
      actor,
      action: "DELETE",
      entityType: "Media",
      entityId: intent.key,
      after: { rejected: verdict.reason },
    });
    throw new ValidationError(verdict.reason);
  }

  const url = store.publicUrl(intent.key);

  if (intent.replacesId) {
    return replaceMedia(actor, intent.replacesId, {
      key: intent.key,
      url,
      size: head.size,
      checksum: head.checksum,
    });
  }

  return withAudit(
    { actor, action: "CREATE", entityType: "Media", entityId: intent.filename },
    async (tx) => {
      const media = await tx.media.create({
        data: {
          key: intent.key,
          url,
          filename: intent.filename,
          mimeType: type.mime,
          size: head.size,
          type: type.kind,
          alt: intent.alt,
          checksum: head.checksum,
          folderId: intent.folderId,
          uploadedById: actor.userId,
        },
        select: { id: true, key: true, url: true, filename: true, type: true, size: true },
      });

      // Version 1 is the file as first uploaded, so a replacement never loses
      // what the original was.
      await tx.mediaVersion.create({
        data: {
          mediaId: media.id,
          version: 1,
          key: intent.key,
          url,
          size: head.size,
          uploadedById: actor.userId,
        },
      });

      return media;
    },
  );
}

/** Record a new version of an existing file. */
async function replaceMedia(
  actor: Actor,
  mediaId: string,
  next: { key: string; url: string; size: number; checksum: string | null },
) {
  requirePermission(actor, "media.edit");

  const existing = await db.media.findFirst({
    where: { id: mediaId, deletedAt: null },
    select: { id: true, key: true, versions: { select: { version: true } } },
  });
  if (!existing) throw new NotFoundError("That file does not exist.");

  const version = existing.versions.reduce((max, row) => Math.max(max, row.version), 0) + 1;

  return withAudit(
    { actor, action: "UPDATE", entityType: "Media", entityId: mediaId, before: { key: existing.key } },
    async (tx) => {
      await tx.mediaVersion.create({
        data: {
          mediaId,
          version,
          key: next.key,
          url: next.url,
          size: next.size,
          uploadedById: actor.userId,
        },
      });

      // The Media row always points at the current version. Older objects stay
      // in the bucket: something published may still reference that URL.
      return tx.media.update({
        where: { id: mediaId },
        data: { key: next.key, url: next.url, size: next.size, checksum: next.checksum },
        select: { id: true, key: true, url: true, filename: true, type: true, size: true },
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

const MAX_PER_PAGE = 96;

export async function listMedia(actor: Actor, params: MediaListParamsInput) {
  requirePermission(actor, "media.view");

  const page = Math.max(1, params.page);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(6, params.perPage));
  const search = params.search?.trim();

  const where: Prisma.MediaWhereInput = {
    deletedAt: null,
    ...(params.type ? { type: params.type } : {}),
    ...(params.folderId ? { folderId: params.folderId } : {}),
    ...(search
      ? {
          OR: [
            { filename: { contains: search, mode: "insensitive" as const } },
            { alt: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.media.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        key: true,
        url: true,
        filename: true,
        mimeType: true,
        type: true,
        size: true,
        alt: true,
        width: true,
        height: true,
        createdAt: true,
        folder: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, name: true } },
        _count: { select: { versions: true } },
      },
    }),
    db.media.count({ where }),
  ]);

  return {
    rows,
    total,
    page,
    perPage,
    pages: Math.max(1, Math.ceil(total / perPage)),
  };
}

export async function getMedia(actor: Actor, id: string) {
  requirePermission(actor, "media.view");

  const media = await db.media.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      key: true,
      url: true,
      filename: true,
      mimeType: true,
      type: true,
      size: true,
      alt: true,
      width: true,
      height: true,
      checksum: true,
      createdAt: true,
      folderId: true,
      folder: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, name: true } },
      versions: {
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          url: true,
          size: true,
          createdAt: true,
          uploadedBy: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!media) throw new NotFoundError("That file does not exist.");
  return media;
}

export async function updateMedia(actor: Actor, input: MediaUpdateInput) {
  requirePermission(actor, "media.edit");

  const existing = await db.media.findFirst({
    where: { id: input.id, deletedAt: null },
    select: { id: true, filename: true, alt: true, folderId: true, mimeType: true },
  });
  if (!existing) throw new NotFoundError("That file does not exist.");

  if (input.folderId) {
    const folder = await db.mediaFolder.findUnique({
      where: { id: input.folderId },
      select: { id: true },
    });
    if (!folder) throw new ValidationError("That folder does not exist.");
  }

  return withAudit(
    { actor, action: "UPDATE", entityType: "Media", entityId: input.id, before: existing },
    (tx) =>
      tx.media.update({
        where: { id: input.id },
        data: {
          // Renaming cannot change the type: the extension is re-derived from
          // the stored mime, not taken from what was typed.
          filename: safeFilename(input.filename, existing.mimeType),
          alt: input.alt ?? null,
          folderId: input.folderId ?? null,
        },
        select: { id: true, filename: true },
      }),
  );
}

/**
 * Soft delete.
 *
 * The row is kept and the object stays in the bucket: something published may
 * still point at that URL, and a media library that hard-deletes leaves holes
 * in old pages (CLAUDE.md 7, soft delete where history matters).
 */
export async function deleteMedia(actor: Actor, id: string) {
  requirePermission(actor, "media.delete");

  const media = await db.media.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      filename: true,
      _count: {
        select: {
          userAvatars: true,
          serviceHeroes: true,
          blogCovers: true,
          caseStudyCovers: true,
          testimonialAvatars: true,
          clientLogos: true,
          contractDocs: true,
          contentItems: true,
          approvalVersions: true,
          popups: true,
          seoOgImages: true,
          seoTwitterImages: true,
        },
      },
    },
  });

  if (!media) throw new NotFoundError("That file does not exist.");

  const inUse = Object.values(media._count).reduce((sum, count) => sum + count, 0);
  if (inUse > 0) {
    throw new ConflictError(
      `That file is used in ${inUse} place${inUse === 1 ? "" : "s"}. Replace it there first.`,
    );
  }

  return withAudit(
    { actor, action: "DELETE", entityType: "Media", entityId: id, before: { filename: media.filename } },
    (tx) =>
      tx.media.update({
        where: { id },
        data: { deletedAt: new Date() },
        select: { id: true },
      }),
  );
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export async function listFolders(actor: Actor) {
  requirePermission(actor, "media.view");

  return db.mediaFolder.findMany({
    orderBy: { path: "asc" },
    select: {
      id: true,
      name: true,
      path: true,
      parentId: true,
      _count: { select: { media: true, children: true } },
    },
  });
}

export async function createFolder(actor: Actor, input: FolderInput) {
  requirePermission(actor, "media.edit");

  let path = `/${input.name}`;

  if (input.parentId) {
    const parent = await db.mediaFolder.findUnique({
      where: { id: input.parentId },
      select: { id: true, path: true },
    });
    if (!parent) throw new ValidationError("That parent folder does not exist.");
    path = `${parent.path}/${input.name}`;
  }

  const clash = await db.mediaFolder.findUnique({ where: { path }, select: { id: true } });
  if (clash) throw new ConflictError("A folder with that name already exists here.");

  return withAudit(
    { actor, action: "CREATE", entityType: "MediaFolder", entityId: path },
    (tx) =>
      tx.mediaFolder.create({
        data: { name: input.name, parentId: input.parentId || null, path },
        select: { id: true, name: true, path: true },
      }),
  );
}

export async function deleteFolder(actor: Actor, id: string) {
  requirePermission(actor, "media.delete");

  const folder = await db.mediaFolder.findUnique({
    where: { id },
    select: { id: true, path: true, _count: { select: { media: true, children: true } } },
  });
  if (!folder) throw new NotFoundError("That folder does not exist.");

  if (folder._count.media > 0 || folder._count.children > 0) {
    throw new ConflictError("Empty the folder first.");
  }

  return withAudit(
    { actor, action: "DELETE", entityType: "MediaFolder", entityId: folder.path },
    (tx) => tx.mediaFolder.delete({ where: { id }, select: { id: true } }),
  );
}
