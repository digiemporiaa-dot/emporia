import "server-only";
import type { Metadata } from "next";
import { siteDefaults } from "@/lib/seo/defaults";
import { absoluteUrl, resolveCanonical } from "@/lib/seo/urls";
import type { EntitySeo } from "@/lib/seo/select";

/**
 * The metadata builder.
 *
 * Every `generateMetadata` on the public site goes through this. The fallback
 * chains live here once and are never duplicated per template (CLAUDE.md 9):
 *
 *   title        entity SEO -> generated from the entity -> site default
 *   description  entity SEO -> entity summary            -> site default
 *   canonical    admin override -> derived from the public URL (always correct)
 *   og:image     entity OG -> parent (service/city) OG   -> global OG
 *   og:image:alt entity alt -> media alt                 -> the title
 *   robots       entity flags, unless the caller forces noindex
 */

export type MetadataInput = {
  /** Site-relative path of this page, used to derive the canonical. */
  path: string;
  /** The entity's own Seo record, if it has one. */
  seo?: EntitySeo | null;
  /** Generated-from-entity values, used when the Seo record is silent. */
  fallback: {
    title: string;
    description?: string | null;
    /** Parent OG image (a service's or city's), tried before the global one. */
    imageUrl?: string | null;
    imageAlt?: string | null;
  };
  /** og:type. Articles also carry published/modified times. */
  type?: "website" | "article";
  publishedTime?: Date | string | null;
  modifiedTime?: Date | string | null;
  /**
   * Force noindex regardless of the entity's flags. Used where a page exists
   * but must not be indexed — a service-city page that fails canPublish(),
   * for instance (Phase 5).
   */
  forceNoIndex?: boolean;
};

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

export async function buildMetadata(input: MetadataInput): Promise<Metadata> {
  const defaults = await siteDefaults();

  const title = input.seo?.metaTitle?.trim() || input.fallback.title || defaults.defaultTitle;

  const description =
    input.seo?.metaDescription?.trim() ||
    input.fallback.description?.trim() ||
    defaults.defaultDescription ||
    undefined;

  const canonical = resolveCanonical(input.path, input.seo?.canonical);

  // og:image chain — entity, then parent, then the global default.
  const imageUrl = input.seo?.ogImage?.url ?? input.fallback.imageUrl ?? defaults.ogImageUrl;
  const imageAlt =
    input.seo?.ogImageAlt?.trim() ||
    input.seo?.ogImage?.alt?.trim() ||
    input.fallback.imageAlt?.trim() ||
    defaults.ogImageAlt ||
    // Never emit an image without alt text (CLAUDE.md 9).
    title;

  const ogImages = imageUrl
    ? [
        {
          url: imageUrl,
          alt: imageAlt,
          ...(input.seo?.ogImage?.width ? { width: input.seo.ogImage.width } : {}),
          ...(input.seo?.ogImage?.height ? { height: input.seo.ogImage.height } : {}),
        },
      ]
    : undefined;

  const twitterImageUrl = input.seo?.twitterImage?.url ?? imageUrl;

  const index = input.forceNoIndex ? false : (input.seo?.robotsIndex ?? true);
  const follow = input.seo?.robotsFollow ?? true;

  return {
    title,
    description,
    alternates: { canonical },
    robots: {
      index,
      follow,
      googleBot: { index, follow },
    },
    openGraph: {
      type: input.type ?? "website",
      siteName: defaults.siteName,
      locale: defaults.locale,
      url: canonical,
      title: input.seo?.ogTitle?.trim() || title,
      description: input.seo?.ogDescription?.trim() || description,
      ...(ogImages ? { images: ogImages } : {}),
      ...(input.type === "article"
        ? {
            publishedTime: toIso(input.publishedTime),
            modifiedTime: toIso(input.modifiedTime),
          }
        : {}),
    },
    twitter: {
      card: twitterImageUrl ? "summary_large_image" : "summary",
      title: input.seo?.twitterTitle?.trim() || input.seo?.ogTitle?.trim() || title,
      description:
        input.seo?.twitterDescription?.trim() || input.seo?.ogDescription?.trim() || description,
      ...(defaults.twitterHandle ? { site: defaults.twitterHandle } : {}),
      ...(twitterImageUrl ? { images: [twitterImageUrl] } : {}),
    },
    metadataBase: new URL(absoluteUrl("/")),
  };
}

/** Metadata for a page that must never be indexed (admin, portal, auth). */
export function privateMetadata(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
  };
}
