import { absoluteUrl } from "@/lib/seo/urls";

/**
 * Breadcrumb trails.
 *
 * The same list drives both the visible breadcrumb and the BreadcrumbList
 * JSON-LD, so the two can never disagree — which is the usual reason
 * structured data gets flagged.
 */
export type Crumb = { name: string; path: string };

export function breadcrumbSchema(crumbs: readonly Crumb[]): object | null {
  if (crumbs.length < 2) return null;

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}
