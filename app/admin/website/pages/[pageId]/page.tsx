import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { getPage, listPageAudit } from "@/lib/services/page.service";
import { isAppError } from "@/lib/errors";
import { PageStatusBadge } from "../page-status";
import { PreviewLink } from "../row-actions";
import { PageSettingsForm } from "./page-settings-form";
import { PageBuilder } from "./builder";
import { SeoPanel } from "./seo-panel";
import { AuditTrail } from "./audit-trail";
import { VersionPanel } from "./version-panel";
import { WorkflowPanel } from "./workflow-panel";
import { SchedulePanel } from "./schedule-panel";
import { listVersions } from "@/lib/services/page-version.service";
import { analysePage } from "@/lib/seo/analyzer";
import { knownPaths, linkSuggestions } from "@/lib/services/seo-links.service";
import { siteDefaults } from "@/lib/seo/defaults";
import { absoluteUrl } from "@/lib/seo/urls";
import { db } from "@/lib/db";
import { mediaIdsIn } from "@/lib/content/blocks";
import { listInsertable } from "@/lib/services/reusable-section.service";
import { taxonomyOptions } from "@/lib/services/taxonomy.service";
import { EMPTY_TAXONOMY } from "@/lib/content/taxonomy";

export const metadata: Metadata = { title: "Edit page" };

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function EditPagePage({ params }: { params: Promise<{ pageId: string }> }) {
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
  const reusables = can(actor, "pages.edit") ? await listInsertable(actor) : [];
  // Loaded once for the whole screen: the filter pickers on every dynamic block
  // share this rather than each fetching the same four lists.
  const taxonomy = can(actor, "pages.edit") ? await taxonomyOptions() : EMPTY_TAXONOMY;
  const versions = await listVersions(actor, page.id);
  // Gated on audit.view, so a role without it simply does not see the section.
  const audit = can(actor, "audit.view") ? await listPageAudit(actor, page.id) : null;

  // The report describes the page as saved, so a social image or an OG record
  // added elsewhere is reflected without the editor having to touch this form.
  const defaults = await siteDefaults();
  // The set of addresses a link may legitimately point at, so the report can
  // say which internal links go nowhere. Fetched here rather than inside the
  // analyzer, which stays a pure function over a snapshot.
  const [paths, suggestions] = await Promise.all([
    knownPaths(),
    linkSuggestions(actor, page.id),
  ]);
  const report = analysePage({
    title: page.title,
    slug: page.slug,
    status: page.status,
    sections: page.sections,
    seo: page.seo,
    hasGlobalOgImage: Boolean(defaults.ogImageUrl),
    knownPaths: paths,
  });

  const seoMediaIds = [page.seo?.ogImageId, page.seo?.twitterImageId].filter((id): id is string =>
    Boolean(id),
  );
  const seoMedia =
    seoMediaIds.length === 0
      ? []
      : await db.media.findMany({
          where: { id: { in: seoMediaIds }, deletedAt: null },
          select: { id: true, url: true, filename: true, type: true },
        });
  const seoMediaById = new Map(seoMedia.map((row) => [row.id, row]));

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
        reusables={reusables}
        taxonomy={taxonomy}
        canEdit={can(actor, "pages.edit")}
      />

      <SchedulePanel
        pageId={page.id}
        status={page.status}
        publishAt={page.publishAt?.toISOString() ?? null}
        unpublishAt={page.unpublishAt?.toISOString() ?? null}
        canPublish={can(actor, "pages.publish")}
      />

      <WorkflowPanel
        pageId={page.id}
        workflow={page.workflow}
        reviewNote={page.reviewNote}
        canEdit={can(actor, "pages.edit")}
        canDecide={can(actor, "pages.publish")}
      />

      <VersionPanel
        pageId={page.id}
        versions={versions.map((entry) => ({
          id: entry.id,
          version: entry.version,
          reason: entry.reason,
          createdAt: DATE.format(entry.createdAt),
          author: entry.createdBy?.name ?? null,
        }))}
        canEdit={can(actor, "pages.edit")}
        canDelete={can(actor, "pages.delete")}
      />

      <SeoPanel
        pageId={page.id}
        seo={page.seo}
        report={report}
        linkSuggestions={suggestions}
        ogImage={page.seo?.ogImageId ? (seoMediaById.get(page.seo.ogImageId) ?? null) : null}
        twitterImage={
          page.seo?.twitterImageId ? (seoMediaById.get(page.seo.twitterImageId) ?? null) : null
        }
        previewUrl={page.previewToken ? absoluteUrl(`/preview/${page.previewToken}`) : null}
        canEditSeo={can(actor, "seo.edit")}
        canEdit={can(actor, "pages.edit")}
      />

      {audit ? <AuditTrail entries={audit} /> : null}
    </>
  );
}
