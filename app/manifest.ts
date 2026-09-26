import type { MetadataRoute } from "next";
import { siteDefaults } from "@/lib/seo/defaults";

/**
 * The web app manifest.
 *
 * The name and description come from site settings rather than being hard-coded,
 * so an operator renaming the site in the admin renames it here too — the same
 * rule the metadata builders follow.
 *
 * `display: "browser"` on purpose. This is a website with an admin behind it,
 * not an installable app, and a standalone display mode would strip the address
 * bar from something people need to share URLs out of.
 */
export const dynamic = "force-dynamic";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { siteName, defaultDescription } = await siteDefaults();

  return {
    name: siteName,
    short_name: siteName,
    description: defaultDescription,
    start_url: "/",
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#002a3a",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
