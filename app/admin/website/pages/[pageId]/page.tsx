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

      <section aria-labelledby="sections-heading" className="mt-10 max-w-2xl">
        <h2 id="sections-heading" className="text-lg text-navy-800">
          Sections
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          This page has {page.sections.length} section
          {page.sections.length === 1 ? "" : "s"}.
        </p>

        {page.sections.length > 0 ? (
          <ol className="mt-4 divide-y divide-line rounded-lg border border-line bg-white">
            {page.sections.map((section, index) => (
              <li key={section.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="w-5 text-right text-xs tabular-nums text-ink-subtle">
                  {index + 1}
                </span>
                <span className="font-medium text-navy-800">{section.name ?? section.type}</span>
                <span className="font-mono text-2xs text-ink-subtle">{section.type}</span>
                {!section.isVisible ? (
                  <span className="ml-auto text-xs text-ink-subtle">Hidden</span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-subtle">
            No sections yet.
          </p>
        )}

        {/*
          Read-only for now. Adding, editing, reordering and hiding sections is
          the visual builder, which is the next phase — showing a disabled
          drag-and-drop surface here would be a mock, not a feature.
        */}
        <p className="mt-3 text-xs text-ink-subtle">
          Editing sections arrives with the page builder.
        </p>
      </section>
    </>
  );
}
