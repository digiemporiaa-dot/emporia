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

  // Thumbnails for every image any section references — image cards hold one
  // per card, so this cannot stop at the first. One batched query.
  const referenced = new Set<string>();
  for (const section of page.sections) {
    for (const id of mediaIdsIn(section.type, section.content)) referenced.add(id);
  }
  const mediaRows =
    referenced.size === 0
      ? []
      : await db.media.findMany({
          where: { id: { in: [...referenced] }, deletedAt: null },
          select: { id: true, url: true, filename: true, type: true },
        });
  const mediaById = Object.fromEntries(mediaRows.map((row) => [row.id, row]));

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
        media={mediaById}
        canEdit={can(actor, "pages.edit")}
      />

    </>
  );
}
