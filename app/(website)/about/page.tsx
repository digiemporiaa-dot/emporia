import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publishedPageSections } from "@/lib/content/queries";
import { PageSections } from "@/components/website/page-sections";
import { buildMetadata, privateMetadata } from "@/lib/seo/metadata";

/**
 * Rendered at request time, with the underlying data cached and tagged.
 * A static route that reads the database would be prerendered at build,
 * forcing the container build to carry database credentials
 * (docs/ARCHITECTURE.md 17.2).
 */
export const dynamic = "force-dynamic";

const SLUG = "about";

export async function generateMetadata(): Promise<Metadata> {
  const page = await publishedPageSections(SLUG);
  if (!page) return privateMetadata("Not found");

  return buildMetadata({
    path: `/${SLUG}`,
    seo: page.seo,
    fallback: { title: page.title },
  });
}

export default async function Page() {
  const page = await publishedPageSections(SLUG);
  if (!page) notFound();

  return <PageSections sections={page.sections} title={page.title} />;
}
