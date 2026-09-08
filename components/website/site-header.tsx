import { siteNavigation } from "@/lib/services/navigation.service";
import { SiteHeaderNav } from "@/components/website/site-header-nav";

/**
 * Site header.
 *
 * A server component that reads the navigation and hands it to the client
 * component that needs interactivity, so the links themselves are rendered on
 * the server and the "use client" boundary sits as low as it can (CLAUDE.md 2
 * rule 8). What it renders is admin-managed; with nothing saved it renders the
 * defaults in lib/services/navigation.service.
 */
export async function SiteHeader() {
  const nav = await siteNavigation();

  return (
    <SiteHeaderNav
      brandName={nav.brandName}
      links={nav.headerLinks}
      cta={nav.cta.enabled ? { label: nav.cta.label, href: nav.cta.href } : null}
    />
  );
}
