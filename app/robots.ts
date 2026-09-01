import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo/urls";

/**
 * robots.txt.
 *
 * The four private prefixes are disallowed explicitly here as well as being
 * absent from the sitemap — belt and braces, since a crawler can find a URL
 * without the sitemap.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/portal", "/auth", "/api"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
