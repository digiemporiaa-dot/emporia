import type { Metadata } from "next";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listFolders, listMedia } from "@/lib/services/media.service";
import { isStorageConfigured } from "@/lib/storage";
import { mediaListParamsSchema } from "@/lib/validation/media";
import { MediaLibrary } from "./media-library";

export const metadata: Metadata = { title: "Media" };
export const dynamic = "force-dynamic";

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/media");
  requirePermission(actor, "media.view");

  const raw = await searchParams;
  const parsed = mediaListParamsSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : mediaListParamsSchema.parse({});

  const [result, folders] = await Promise.all([listMedia(actor, params), listFolders(actor)]);

  return (
    <>
      <header className="mb-5">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">Library</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Media</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Files go straight from your browser to storage; this server only checks what landed.
        </p>
      </header>

      <MediaLibrary
        items={result.rows.map((row) => ({
          id: row.id,
          url: row.url,
          filename: row.filename,
          mimeType: row.mimeType,
          type: row.type,
          size: row.size,
          alt: row.alt,
          width: row.width,
          height: row.height,
          // Dates cross the boundary as ISO strings.
          createdAt: row.createdAt.toISOString(),
          folder: row.folder,
          uploadedBy: row.uploadedBy,
          versions: row._count.versions,
        }))}
        folders={folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          path: folder.path,
          parentId: folder.parentId,
          count: folder._count.media,
        }))}
        total={result.total}
        page={result.page}
        pages={result.pages}
        canUpload={can(actor, "media.upload")}
        canEdit={can(actor, "media.edit")}
        canDelete={can(actor, "media.delete")}
        storageConfigured={isStorageConfigured()}
      />
    </>
  );
}
