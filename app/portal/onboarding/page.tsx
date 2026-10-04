import type { Metadata } from "next";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { isAppError } from "@/lib/errors";
import { listCountries } from "@/lib/geo/countries";
import { getMyOnboarding, portalListGscSites } from "@/lib/services/onboarding.service";
import { googleOAuthApp } from "@/lib/seo-intel/google/settings";
import { globals } from "@/lib/services/email.service";
import { STEP_NEEDS, type OnboardingStepKey } from "@/lib/onboarding/steps";
import { SOCIAL_PLATFORM_LABEL, type SocialPlatform } from "@/lib/validation/onboarding";
import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { BrandUpload } from "./brand-upload";
import { AnalyticsForm, BrandColorsForm, BusinessForm, CompanyForm, RemoveAssetButton, SiteChoiceForm, SocialForm, WebsiteForm } from "./forms";

export const metadata: Metadata = { title: "Account setup" };

/**
 * Starts the Google sign-in. A plain anchor, not <Link>: Link prefetches, and
 * prefetching a redirecting route would start a sign-in nobody asked for.
 */
const CONNECT_HREF = "/api/portal/google/connect";
export const dynamic = "force-dynamic";

const OUTCOME: Record<string, { tone: "ok" | "error" | "neutral"; text: string }> = {
  "signed-in": { tone: "ok", text: "Signed in with Google. Now choose your Search Console property below." },
  cancelled: { tone: "neutral", text: "Google sign-in was cancelled. Nothing changed." },
  failed: { tone: "error", text: "Google sign-in did not finish." },
};

function StepCard({
  id,
  title,
  state,
  children,
}: {
  id: OnboardingStepKey;
  title: string;
  state: "done" | "todo" | "not-applicable";
  children: React.ReactNode;
}) {
  return (
    <Card id={`step-${id.toLowerCase()}`} className="scroll-mt-6">
      <CardHeader className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{STEP_NEEDS[id]}</CardDescription>
        </div>
        {state === "done" ? <Badge tone="success">Done</Badge> : state === "not-applicable" ? <Badge tone="neutral">Not needed</Badge> : <Badge tone="warning">To do</Badge>}
      </CardHeader>
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

/**
 * Account setup: the checklist a new client works through. Every write is
 * scoped to the signed-in user's own client; nothing asks for a password.
 */
export default async function PortalOnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requirePortalActorPage();
  const raw = await searchParams;
  const [view, site, oauth] = await Promise.all([getMyOnboarding(actor), globals(), googleOAuthApp().catch(() => null)]);
  const state = (step: OnboardingStepKey) => view.progress.steps.find((s) => s.step === step)?.state ?? "todo";

  const pending = view.searchConsole.find((property) => property.status && property.status !== "CONNECTED");
  const connected = view.searchConsole.find((property) => property.status === "CONNECTED");
  let sites: Awaited<ReturnType<typeof portalListGscSites>> | null = null;
  let sitesError: string | null = null;
  if (pending) {
    try {
      sites = await portalListGscSites(actor, pending.id);
    } catch (error) {
      sitesError = isAppError(error) ? error.publicMessage : "Your Search Console properties could not be read.";
    }
  }

  const outcomeKey = typeof raw["connection"] === "string" ? raw["connection"] : null;
  const outcome = outcomeKey ? OUTCOME[outcomeKey] : null;
  const reason = typeof raw["reason"] === "string" ? raw["reason"] : null;
  const connectedPlatforms = new Set(view.connectedSocial.map((account) => account.provider));

  return (
    <>
      <header className="mb-6">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">{view.client.name}</p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Welcome to {site.siteName} 👋</h1>
        <p className="mt-1.5 text-sm text-ink-muted">Let&apos;s get your account ready. Each step saves on its own — come back any time.</p>
        <div className="mt-4 max-w-md">
          <div className="flex items-baseline justify-between text-xs text-ink-muted">
            <span>Account setup</span>
            <span className="font-medium tabular-nums text-navy-800">{view.progress.percent}%</span>
          </div>
          <div role="progressbar" aria-label="Account setup" aria-valuenow={view.progress.percent} aria-valuemin={0} aria-valuemax={100} className="mt-1 h-2 overflow-hidden rounded-full bg-surface-sunken">
            <div className="h-full rounded-full bg-navy-700" style={{ width: `${view.progress.percent}%` }} />
          </div>
        </div>
        <nav aria-label="Setup steps" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {view.progress.steps
            .filter((step) => step.state !== "not-applicable")
            .map((step) => (
              <a key={step.step} href={`#step-${step.step.toLowerCase()}`} className={step.state === "done" ? "text-success" : "text-navy-800 hover:text-brand-red"}>
                <span aria-hidden="true">{step.state === "done" ? "✓ " : "○ "}</span>
                {step.label}
                <span className="sr-only">{step.state === "done" ? " (done)" : " (to do)"}</span>
              </a>
            ))}
        </nav>
      </header>

      {outcome ? (
        <p
          role={outcome.tone === "error" ? "alert" : "status"}
          className={`mb-4 rounded-md border px-3.5 py-3 text-sm ${outcome.tone === "error" ? "border-red-100 bg-red-50 text-brand-red-text" : outcome.tone === "ok" ? "border-success/30 bg-success-bg text-success" : "border-line bg-white text-ink-muted"}`}
        >
          {outcome.text} {outcome.tone === "error" && reason ? reason : null}
        </p>
      ) : null}

      <div className="space-y-4">
        {state("COMPANY") !== "not-applicable" ? (
          <StepCard id="COMPANY" title="Company details" state={state("COMPANY")}>
            <CompanyForm countries={listCountries()} values={{ ...view.profile, industry: view.client.industry, website: view.client.website }} />
          </StepCard>
        ) : null}

        {state("BRAND") !== "not-applicable" ? (
          <StepCard id="BRAND" title="Brand assets" state={state("BRAND")}>
            {view.assets.length ? (
              <ul className="divide-y divide-line rounded-md border border-line">
                {view.assets.map((asset) => (
                  <li key={asset.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 text-sm">
                      <a href={asset.media.url} target="_blank" rel="noreferrer noopener" className="break-all text-navy-800 hover:text-brand-red">
                        {asset.media.filename}
                      </a>
                      <span className="ml-2 text-2xs text-ink-subtle">{asset.kind === "LOGO" ? "Logo" : asset.kind === "GUIDELINES" ? "Guidelines" : "Other"}</span>
                    </span>
                    <RemoveAssetButton assetId={asset.id} filename={asset.media.filename} />
                  </li>
                ))}
              </ul>
            ) : null}
            <BrandUpload />
            <BrandColorsForm colors={view.brandColors} />
          </StepCard>
        ) : null}

        {state("WEBSITE") !== "not-applicable" ? (
          <StepCard id="WEBSITE" title="Website access" state={state("WEBSITE")}>
            <WebsiteForm accessEmail={view.accessEmail} values={{ platform: view.website.platform, loginUrl: view.website.loginUrl, notes: view.website.notes, confirmed: Boolean(view.website.confirmedAt) }} />
          </StepCard>
        ) : null}

        {state("ANALYTICS") !== "not-applicable" ? (
          <StepCard id="ANALYTICS" title="Google Analytics" state={state("ANALYTICS")}>
            <AnalyticsForm accessEmail={view.accessEmail} serviceAccountEmail={view.serviceAccountEmail} values={{ propertyId: view.analytics.propertyId, confirmed: Boolean(view.analytics.confirmedAt) }} />
          </StepCard>
        ) : null}

        {state("SEARCH_CONSOLE") !== "not-applicable" ? (
          <StepCard id="SEARCH_CONSOLE" title="Search Console" state={state("SEARCH_CONSOLE")}>
            {connected ? (
              <p className="text-sm text-ink-muted">
                Connected: <span className="break-all font-mono text-xs text-navy-800">{connected.siteUrl}</span>
                {connected.accountEmail ? ` (${connected.accountEmail})` : ""}.
              </p>
            ) : pending ? (
              <>
                {sitesError ? <p role="alert" className="text-sm text-brand-red-text">{sitesError}</p> : null}
                {sites && sites.length === 0 ? <p className="text-sm text-ink-muted">This Google account cannot see any Search Console properties. Sign in with the account that manages your website&apos;s Search Console.</p> : null}
                {sites && sites.length > 0 ? <SiteChoiceForm propertyId={pending.id} domain={pending.domain} sites={sites} /> : null}
                {oauth ? (
                  <a href={CONNECT_HREF} className="inline-block text-sm text-navy-800 underline underline-offset-2 hover:text-brand-red">
                    Sign in with a different Google account
                  </a>
                ) : null}
              </>
            ) : oauth ? (
              <>
                <p className="text-sm text-ink-muted">
                  Sign in with the Google account that manages your website in Search Console. We get read-only access to search data —
                  nothing else.
                </p>
                {!view.client.website ? <p className="text-xs text-ink-subtle">Add your website in Company details first.</p> : null}
                  <a href={CONNECT_HREF} className="inline-flex items-center rounded-md bg-brand-red px-3.5 py-2 text-sm font-medium text-white hover:bg-red-600">
                  Sign in with Google
                </a>
                {view.serviceAccountEmail ? (
                  <p className="text-xs text-ink-subtle">
                    Prefer not to sign in? Add <span className="break-all font-mono text-navy-800">{view.serviceAccountEmail}</span> as a user in Search
                    Console → Settings → Users and permissions, and let your account manager know.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-ink-muted">
                {view.serviceAccountEmail ? (
                  <>
                    Add <span className="break-all font-mono text-navy-800">{view.serviceAccountEmail}</span> as a user in Search Console → Settings → Users
                    and permissions, then let your account manager know — they will finish the connection.
                  </>
                ) : (
                  "Your account manager will set this up with you."
                )}
              </p>
            )}
          </StepCard>
        ) : null}

        {state("SOCIAL") !== "not-applicable" ? (
          <StepCard id="SOCIAL" title="Social accounts" state={state("SOCIAL")}>
            <p className="text-sm text-ink-muted">Tell us where you are. Our team connects each account for you; this step completes when every profile you list is connected.</p>
            {view.socialProfiles.length ? (
              <ul className="space-y-1 text-sm">
                {view.socialProfiles.map((profile) => (
                  <li key={`${profile.platform}-${profile.handle}`} className="flex flex-wrap items-center gap-2">
                    <span className="text-navy-800">{SOCIAL_PLATFORM_LABEL[profile.platform as SocialPlatform]}</span>
                    <span className="break-all text-ink-muted">{profile.handle}</span>
                    {connectedPlatforms.has(profile.platform) ? <Badge tone="success">Connected</Badge> : <Badge tone="neutral">Waiting for us</Badge>}
                  </li>
                ))}
              </ul>
            ) : null}
            <SocialForm profiles={view.socialProfiles} />
          </StepCard>
        ) : null}

        {state("BUSINESS") !== "not-applicable" ? (
          <StepCard id="BUSINESS" title="Business information" state={state("BUSINESS")}>
            <BusinessForm values={view.profile} />
          </StepCard>
        ) : null}
      </div>
    </>
  );
}
