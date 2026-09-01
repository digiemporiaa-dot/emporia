/**
 * The `Seo` fields every indexable entity selects.
 *
 * One fragment, so a template cannot accidentally read a narrower set and lose
 * a field from the fallback chain.
 */
export const seoSelect = {
  metaTitle: true,
  metaDescription: true,
  canonical: true,
  ogTitle: true,
  ogDescription: true,
  ogImageAlt: true,
  ogImage: { select: { url: true, alt: true, width: true, height: true } },
  twitterTitle: true,
  twitterDescription: true,
  twitterImage: { select: { url: true, alt: true } },
  robotsIndex: true,
  robotsFollow: true,
  schemaType: true,
} as const;

export type EntitySeo = {
  metaTitle: string | null;
  metaDescription: string | null;
  canonical: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageAlt: string | null;
  ogImage: { url: string; alt: string | null; width: number | null; height: number | null } | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: { url: string; alt: string | null } | null;
  robotsIndex: boolean;
  robotsFollow: boolean;
  schemaType: string;
};
