import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { getReusableSection, listUsages } from "@/lib/services/reusable-section.service";
import { isAppError } from "@/lib/errors";
import { db } from "@/lib/db";
import { mediaIdsIn, isBlockType, blockDefinition } from "@/lib/content/blocks";
import { PageStatusBadge } from "../../pages/page-status";
import { ReusableEditor } from "./reusable-editor";
import { taxonomyOptions } from "@/lib/services/taxonomy.service";

export const metadata: Metadata = { title: "Reusable section" };

export default async function ReusableSectionPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const { sectionId } = await params;
  const actor = await requireActorPage("/admin/website/sections");
  requirePermission(actor, "pages.edit");

  let section;
  try {
    section = await getReusableSection(actor, sectionId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  if (!isBlockType(section.type)) notFound();

  const usages = await listUsages(actor, sectionId);

  const referenced = mediaIdsIn(section.type, section.content);
  const mediaRows =
    referenced.length === 0
      ? []
      : await db.media.findMany({
          where: { id: { in: referenced }, deletedAt: null },
          select: { id: true, url: true, filename: true, type: true },
        });
  const mediaById = Object.fromEntries(mediaRows.map((row) => [row.id, row]));
  const taxonomy = await taxonomyOptions();

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <span>Website</span>
          <span aria-hidden="true"> / </span>
          <Link href="/admin/website/sections" className="hover:text-navy-800">
            Reusable sections
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{section.name}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{section.name}</h1>
          <PageStatusBadge status={section.status} />
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          {blockDefinition(section.type).label} · <span className="font-mono">{section.key}</span>
        </p>
      </header>

      <ReusableEditor
        taxonomy={taxonomy}
        section={{
          id: section.id,
          name: section.name,
          type: section.type,
          status: section.status,
          isGlobal: section.isGlobal,
          content: section.content,
          placements: section._count.usages,
        }}
        media={mediaById}
        usages={usages.map((usage) => ({
          sectionId: usage.id,
          isVisible: usage.isVisible,
          pageId: usage.page.id,
          pageTitle: usage.page.title,
          pageSlug: usage.page.slug,
          pageStatus: usage.page.status,
        }))}
        canDelete={can(actor, "pages.delete")}
      />
    </>
  );
}
