import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { getPage } from "@/lib/services/page.service";
import { isAppError } from "@/lib/errors";
import { parseSections } from "@/lib/content/sections";
import { resolveSectionImages } from "@/lib/content/media";
import { PageSections } from "@/components/website/page-sections";
import { PageStatusBadge } from "../../page-status";

/**
 * Draft preview.
 *
 * Renders the page through the *same* renderer and the same `parseSections`
 * validation the public route uses, so what an editor sees here is what the
 * site will produce — not a separate approximation that can drift.
 *
 * Two deliberate differences from the public route: hidden sections are shown,
 * marked as hidden, because the point of a preview is to see the whole page you
 * are editing; and the page is fetched by id through the service, so a DRAFT
 * renders. Authorization is the ordinary `pages.view` check — this route lives
 * under /admin, which is noindex and behind the session guard.
 *
 * A shareable link for someone without an admin account is a tokenised
 * preview, which belongs with the publishing workflow rather than here.
 */

export const metadata: Metadata = {
  title: "Preview",
  robots: { index: false, follow: false },
};

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  const actor = await requireActorPage("/admin/website/pages");
  requirePermission(actor, "pages.view");

  let page;
  try {
    page = await getPage(actor, pageId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const sections = parseSections(page.sections);
  const images = Object.fromEntries(await resolveSectionImages(sections));
  const dropped = page.sections.length - sections.length;
  const hidden = page.sections.filter((section) => !section.isVisible).length;

  return (
    <div className="-m-4 lg:-m-6">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-line bg-white px-4 py-2.5 text-xs lg:px-6">
        <Link href={`/admin/website/pages/${page.id}`} className="text-ink-muted hover:text-navy-800">
          ← Back to editor
        </Link>
        <span className="font-medium text-navy-800">{page.title}</span>
        <PageStatusBadge status={page.status} />
        <span className="font-mono text-ink-subtle">/{page.slug}</span>

        <span className="ml-auto flex items-center gap-3 text-ink-subtle">
          {hidden > 0 ? (
            <span>
              {hidden} hidden section{hidden === 1 ? "" : "s"} shown here, not on the live page
            </span>
          ) : null}
          {dropped > 0 ? (
            // Surfaced rather than swallowed: a section that fails its own
            // schema is skipped on the public page too, and an editor should
            // find that out here rather than from a gap on the live site.
            <span className="text-warning">
              {dropped} section{dropped === 1 ? "" : "s"} could not be rendered
            </span>
          ) : null}
        </span>
      </div>

      {sections.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-ink-subtle lg:px-6">
          Nothing to preview yet — this page has no renderable sections.
        </p>
      ) : (
        <div className="bg-white">
          <PageSections sections={sections} title={page.title} images={images} />
        </div>
      )}
    </div>
  );
}
