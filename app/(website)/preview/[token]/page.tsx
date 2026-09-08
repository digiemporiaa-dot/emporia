import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPageByPreviewToken } from "@/lib/services/page.service";
import { parseSections } from "@/lib/content/sections";
import { resolveSectionImages } from "@/lib/content/media";
import { PageSections } from "@/components/website/page-sections";
import { privateMetadata } from "@/lib/seo/metadata";

/**
 * Shareable draft preview.
 *
 * Unauthenticated by design — the point is to show a draft to a client who has
 * no admin account — so the token in the URL is the entire credential. It is 32
 * bytes from a CSPRNG, it is not listed anywhere, it is revoked by rotating or
 * clearing it, and this route is noindex and absent from the sitemap.
 *
 * What it renders is what the public page would render, through the same
 * renderer and the same validation: hidden sections are excluded here too, so
 * a reviewer is looking at the page as it would ship rather than at a variant
 * only this route produces. (The admin preview is the one that shows hidden
 * sections, because that reader is the person editing them.)
 */

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return privateMetadata("Preview");
}

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const page = await getPageByPreviewToken(token);
  // An unknown, revoked or rotated token is indistinguishable from a URL that
  // never existed, which is what it should look like.
  if (!page) notFound();

  const sections = parseSections(page.sections);
  const images = Object.fromEntries(await resolveSectionImages(sections));

  return (
    <>
      <div className="border-b border-line bg-navy-800 px-5 py-2.5 text-center text-xs text-navy-100 lg:px-8">
        Draft preview of <span className="font-medium text-white">{page.title}</span>
        {page.status === "PUBLISHED"
          ? " — this page is live; you may be seeing unpublished edits."
          : " — this page is not published yet."}
      </div>
      <PageSections sections={sections} title={page.title} images={images} />
    </>
  );
}
