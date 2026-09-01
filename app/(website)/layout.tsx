import { SiteHeader } from "@/components/website/site-header";
import { SiteFooter } from "@/components/website/site-footer";

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
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
