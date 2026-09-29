import { PortalSocialTabs } from "@/components/portal/social-tabs";

/**
 * The client's social section. The portal layout above has already confirmed
 * a client session; every page below scopes by that session's client.
 */
export default function PortalSocialLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl text-navy-800">Social</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Your social media: what is planned, what needs you, what went out and how it did.
        </p>
      </header>
      <PortalSocialTabs />
      <div className="mt-5">{children}</div>
    </>
  );
}
