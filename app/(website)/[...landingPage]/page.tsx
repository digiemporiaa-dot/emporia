import type { Metadata } from "next";
import type { Route } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { publishedPageSections } from "@/lib/content/queries";
import { PageSections } from "@/components/website/page-sections";
import { buildMetadata, privateMetadata } from "@/lib/seo/metadata";
import { resolveRedirect } from "@/lib/services/redirect.service";
import { isReservedSlug } from "@/lib/utils/slug";

/**
 * CMS landing pages, and the redirect fallback.
 *
 * This is the last route to match, so it only runs for paths no real route
 * claimed — which is exactly the set of URLs a redirect exists for. That is why
 * redirects need no middleware: Prisma cannot run on the edge runtime, and a
 * Node middleware would add a database round trip to every request on the site
 * (docs/ARCHITECTURE.md 12.4).
 *
 * Order: CMS page, then redirect, then 404.
 */
export const dynamic = "force-dynamic";


function slugFrom(segments: string[]): string | null {
  // Only single-segment CMS pages, so a deep path cannot collide with a
  // sectioned route such as /services/seo/gurgaon (Phase 5).
  if (segments.length !== 1) return null;
  const slug = segments[0];
  if (!slug || isReservedSlug(slug)) return null;
  return slug;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ landingPage: string[] }>;
}): Promise<Metadata> {
  const { landingPage } = await params;
  const slug = slugFrom(landingPage);
  if (!slug) return privateMetadata("Not found");

  const page = await publishedPageSections(slug);
  if (!page) return privateMetadata("Not found");

  return buildMetadata({
    path: `/${slug}`,
    seo: page.seo,
    fallback: { title: page.title },
  });
}

export default async function LandingPage({
  params,
}: {
  params: Promise<{ landingPage: string[] }>;
}) {
  const { landingPage } = await params;
  const path = `/${landingPage.join("/")}`;

  const slug = slugFrom(landingPage);
  if (slug) {
    const page = await publishedPageSections(slug);
    if (page) {
      return <PageSections sections={page.sections} title={page.title} />;
    }
  }

  const target = await resolveRedirect(path);
  if (target) {
    // A redirect destination is admin-managed data, so it cannot be a
    // statically known route — it may even be an external URL. typedRoutes has
    // nothing to check it against, hence the cast. The value is validated and
    // loop-checked at write time in redirect.service.
    const destination = target.toPath as Route;

    // Permanent redirects are sent as 308 and temporary as 307 — the
    // method-preserving equivalents of 301 and 302, which are what Next's
    // primitives emit. See isPermanent() in redirect.service for why.
    if (target.permanent) permanentRedirect(destination);
    redirect(destination);
  }

  notFound();
}
