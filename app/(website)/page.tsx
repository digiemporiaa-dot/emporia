import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publishedPageWithCollections, siteSettings } from "@/lib/content/queries";
import { buildMetadata } from "@/lib/seo/metadata";
import { siteDefaults } from "@/lib/seo/defaults";
import { organizationSchema, webSiteSchema } from "@/lib/seo/schema";
import { JsonLd } from "@/components/website/json-ld";
import { PageSections } from "@/components/website/page-sections";

/**
 * Homepage.
 *
 * A CMS page like any other. It used to be 581 lines of hand-composed bands
 * reading five CMS sections and seven entity collections directly; every one of
 * those bands is now a section type, so the whole page is editable from
 * Admin → Website → Pages → Home while rendering the same markup it always did
 * (docs/ARCHITECTURE.md 11A.7).
 *
 * The public URL stays `/`. The CMS record's slug is `home`, which is a
 * reserved slug the catch-all route refuses to serve — so there is exactly one
 * URL for this page, and it is this one.
 *
 * Rendered at request time with the underlying data cached and tagged. A static
 * route that reads the database would be prerendered at build, forcing the
 * container build to carry database credentials (docs/ARCHITECTURE.md 17.2).
 */
export const dynamic = "force-dynamic";

const SLUG = "home";

export async function generateMetadata(): Promise<Metadata> {
  const [result, defaults] = await Promise.all([
    publishedPageWithCollections(SLUG),
    siteDefaults(),
  ]);

  return buildMetadata({
    path: "/",
    seo: result?.page.seo ?? null,
    fallback: { title: defaults.defaultTitle, description: defaults.defaultDescription },
  });
}

export default async function HomePage() {
  const result = await publishedPageWithCollections(SLUG);
  if (!result) notFound();

  const contact = await siteSettings(["site.email", "site.phone", "site.address"]);

  // Organization and WebSite are emitted once, on the home page only.
  const schema = await Promise.all([
    organizationSchema({
      email: contact["site.email"] ?? null,
      phone: contact["site.phone"] ?? null,
      address: contact["site.address"] ?? null,
    }),
    webSiteSchema(),
  ]);

  return (
    <>
      <JsonLd schema={schema} />
      <PageSections
        sections={result.page.sections}
        title={result.page.title}
        images={result.page.images}
        collections={result.collections}
      />
    </>
  );
}
