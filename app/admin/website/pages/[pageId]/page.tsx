import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { getPage } from "@/lib/services/page.service";
import { isAppError } from "@/lib/errors";
import { PageStatusBadge } from "../page-status";
import { PreviewLink } from "../row-actions";
import { PageSettingsForm } from "./page-settings-form";
import { PageBuilder } from "./builder";
import { db } from "@/lib/db";
import { mediaIdsIn } from "@/lib/content/blocks";

export const metadata: Metadata = { title: "Edit page" };

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function EditPagePage({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  const actor = await requireActorPage("/admin/website/pages");
  requirePermission(actor, "pages.edit");

  let page;
  try {
    page = await getPage(actor, pageId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  // Thumbnails for sections that reference an image, so the editor opens with
  // the current selection shown rather than an empty picker. One batched query.
  const mediaBySection = new Map<string, string>();
  for (const section of page.sections) {
    const [mediaId] = mediaIdsIn(section.type, section.content);
    if (mediaId) mediaBySection.set(section.id, mediaId);
  }
  const mediaRows =
    mediaBySection.size === 0
      ? []
      : await db.media.findMany({
          where: { id: { in: [...new Set(mediaBySection.values())] }, deletedAt: null },
          select: { id: true, url: true, filename: true, type: true },
        });
  const byId = new Map(mediaRows.map((row) => [row.id, row]));
  const sectionMedia = Object.fromEntries(
    [...mediaBySection.entries()].flatMap(([sectionId, mediaId]) => {
      const row = byId.get(mediaId);
      return row ? [[sectionId, row] as const] : [];
    }),
  );

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <span>Website</span>
          <span aria-hidden="true"> / </span>
          <Link href="/admin/website/pages" className="hover:text-navy-800">
            Pages
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{page.title}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{page.title}</h1>
          <PageStatusBadge status={page.status} />
          <PreviewLink id={page.id} />
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Last updated {DATE.format(page.updatedAt)}
          {page.publishedAt ? ` · first published ${DATE.format(page.publishedAt)}` : ""}
        </p>
      </header>

      <PageSettingsForm page={page} canPublish={can(actor, "pages.publish")} />

      <PageBuilder
        pageId={page.id}
        sections={page.sections}
        media={sectionMedia}
        canEdit={can(actor, "pages.edit")}
      />

    </>
  );
}
