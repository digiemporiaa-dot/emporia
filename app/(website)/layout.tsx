import type { Metadata } from "next";
import { publicTrackingConfig } from "@/lib/services/tracking.service";
import { SiteHeader } from "@/components/website/site-header";
import { SiteFooter } from "@/components/website/site-footer";
import { PopupHost } from "@/components/website/popup-host";
import { Tracking, TrackingNoScript } from "@/components/website/tracking";

/**
 * Search Console verification.
 *
 * On the layout rather than in a component so it lands in <head>, and merged
 * rather than overridden: a page setting its own title does not drop the
 * verification tag, because it never sets `verification`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { siteVerification } = await publicTrackingConfig();
  if (!siteVerification) return {};
  return { verification: { google: siteVerification } };
}

/**
 * Public website shell.
 *
 * A route group, so the marketing site, the admin and the portal stay
 * structurally separate while sharing services rather than components
 * (CLAUDE.md 5).
 */
export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      {/* GTM's noscript iframe belongs as early in the body as possible. */}
      <TrackingNoScript />
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      {/* Asks the server what to show for this path; renders at most one. */}
      <PopupHost />
      {/*
        Every tracking script on the public site is loaded from here and
        nowhere else, so what runs on a page is a question with one answer
        (docs/ARCHITECTURE.md 14A.1).
      */}
      <Tracking />
    </div>
  );
}
