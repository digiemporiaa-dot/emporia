import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publishedPageSections } from "@/lib/content/queries";
import { PageSections } from "@/components/website/page-sections";

/**
 * Rendered at request time, with the underlying data cached and tagged.
 * A static route that reads the database would be prerendered at build,
 * forcing the container build to carry database credentials
 * (docs/ARCHITECTURE.md 17.2).
 */
export const dynamic = "force-dynamic";

const SLUG = "privacy-policy";

export async function generateMetadata(): Promise<Metadata> {
  const page = await publishedPageSections(SLUG);
  if (!page) return { title: "Not found" };

  return {
    title: page.seo?.metaTitle ?? page.title,
    description: page.seo?.metaDescription ?? undefined,
  };
}

export default async function Page() {
  const page = await publishedPageSections(SLUG);
  if (!page) notFound();

  return <PageSections sections={page.sections} title={page.title} />;
}
