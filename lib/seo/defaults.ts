import "server-only";
import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

/**
 * Site-level SEO defaults, the last link in every fallback chain.
 *
 * Read from SiteSetting rather than hardcoded, so the team can change the
 * global title, description and OG image without a deploy (CLAUDE.md 9).
 */

export type SiteDefaults = {
  siteName: string;
  defaultTitle: string;
  defaultDescription: string;
  titleTemplate: string;
  ogImageUrl: string | null;
  ogImageAlt: string | null;
  twitterHandle: string | null;
  locale: string;
};

const KEYS = [
  "site.name",
  "site.description",
  "seo.defaultMetaTitle",
  "seo.defaultMetaDescription",
  "seo.titleTemplate",
  "seo.ogImageUrl",
  "seo.ogImageAlt",
  "seo.twitterHandle",
  "seo.locale",
] as const;

export const siteDefaults = unstable_cache(
  async (): Promise<SiteDefaults> => {
    const rows = await db.siteSetting.findMany({
      where: { key: { in: [...KEYS] } },
      select: { key: true, value: true },
    });

    const map: Record<string, string> = {};
    for (const row of rows) {
      if (typeof row.value === "string" && row.value.trim()) map[row.key] = row.value.trim();
    }

    const siteName = map["site.name"] ?? "Emporia";

    return {
      siteName,
      defaultTitle: map["seo.defaultMetaTitle"] ?? siteName,
      defaultDescription: map["seo.defaultMetaDescription"] ?? map["site.description"] ?? "",
      titleTemplate: map["seo.titleTemplate"] ?? `%s · ${siteName}`,
      ogImageUrl: map["seo.ogImageUrl"] ?? null,
      ogImageAlt: map["seo.ogImageAlt"] ?? null,
      twitterHandle: map["seo.twitterHandle"] ?? null,
      locale: map["seo.locale"] ?? "en_IN",
    };
  },
  ["site-seo-defaults"],
  { revalidate: 3600, tags: ["site-settings"] },
);
