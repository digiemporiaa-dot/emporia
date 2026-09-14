import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { getPage } from "@/lib/services/page.service";
import { isAppError } from "@/lib/errors";
import { parseSections } from "@/lib/content/sections";
import { resolveSectionImages } from "@/lib/content/media";
import { audienceAllows, type AudienceRule } from "@/lib/content/audience";
import { previewVisitorSchema } from "@/lib/validation/audience";
import { PageSections } from "@/components/website/page-sections";

/**
 * The page, rendered bare, for the device preview's iframe.
 *
 * It lives outside /admin for one reason: it must not inherit the admin
 * layout's sidebar. Framing an /admin URL would nest the whole shell inside the
 * device viewport and show an editor their own navigation at phone width.
 *
 * Why an iframe at all, rather than a narrow `<div>`: Tailwind's breakpoints
 * key off the *viewport*, not the element. A div constrained to 390px still
 * matches `lg:`, so a "phone preview" built that way would show the desktop
 * layout squeezed — confidently, and wrongly. An iframe has its own viewport,
 * so the media queries resolve exactly as they will on the device.
 *
 * Authorization is the ordinary `pages.view` check the page itself performs;
 * the prefix is also in middleware's protected list so an unauthenticated
 * request gets a real 307 before any rendering starts.
 */

export const metadata: Metadata = {
  title: "Preview frame",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function PreviewFramePage({
  params,
  searchParams,
}: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { pageId } = await params;
  const actor = await requireActorPage(`/admin/website/pages/${pageId}/preview`);
  requirePermission(actor, "pages.view");

  let page;
  try {
    page = await getPage(actor, pageId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const parsed = parseSections(page.sections);

  // Preview as somebody. The editor chooses a visitor and the same matcher the
  // public page uses decides what they would see — not a separate "preview"
  // code path, which is how a preview comes to disagree with the live site.
  const raw = await searchParams;
  const asVisitor = previewVisitorSchema.safeParse(raw);
  const visitor = asVisitor.success ? asVisitor.data : previewVisitorSchema.parse({});

  const audiences: Record<string, AudienceRule[]> = {};
  for (const section of page.sections) {
    if (section.audiences.length > 0) audiences[section.id] = section.audiences;
  }

  const sections = parsed.filter((section) =>
    audienceAllows(audiences[section.id] ?? [], {
      device: visitor.device,
      isNewVisitor: visitor.visitor === "NEW",
      utmSource: visitor.utmSource ?? null,
      utmMedium: visitor.utmMedium ?? null,
      utmCampaign: visitor.utmCampaign ?? null,
      referrer: visitor.referrer ?? null,
    }),
  );

  const images = Object.fromEntries(await resolveSectionImages(sections));

  if (sections.length === 0) {
    return (
      <p className="px-5 py-16 text-center text-sm text-ink-subtle">
        Nothing to preview yet — this page has no renderable sections.
      </p>
    );
  }

  return <PageSections sections={sections} title={page.title} images={images} />;
}
