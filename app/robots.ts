import type { MetadataRoute } from "next";
import { absoluteUrl, siteOrigin } from "@/lib/seo/urls";

/**
 * robots.txt.
 *
 * The private prefixes are disallowed explicitly here as well as being
 * absent from the sitemap — belt and braces, since a crawler can find a URL
 * without the sitemap. `/print` holds printable reports, which authenticate
 * and are noindex, but are no more public than the portal.
 */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin", "/portal", "/auth", "/api", "/print"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    // An origin, not a URL: a trailing slash makes the directive invalid.
    host: siteOrigin(),
  };
}
