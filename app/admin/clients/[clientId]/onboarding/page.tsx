import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { isAppError } from "@/lib/errors";
import { countryName } from "@/lib/geo/countries";
import { getClientOnboarding } from "@/lib/services/onboarding.service";
import { STEP_NEEDS } from "@/lib/onboarding/steps";
import { SOCIAL_PLATFORM_LABEL, WEBSITE_PLATFORM_LABEL, WEEKDAYS, type SocialPlatform } from "@/lib/validation/onboarding";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { AccessEmailForm, NotApplicableToggle } from "./staff-forms";

export const metadata: Metadata = { title: "Client onboarding" };
export const dynamic = "force-dynamic";

const WHEN = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <dt className="text-ink-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-navy-800">{value ?? <span className="text-ink-subtle">—</span>}</dd>
    </>
  );
}

/**
 * What a client has given during onboarding, and how far they are. Read-only
 * apart from marking a step not needed: the information is the client's.
 */
export default async function ClientOnboardingPage({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const actor = await requireActorPage(`/admin/clients/${clientId}/onboarding`);
  const view = await getClientOnboarding(actor, clientId).catch((error: unknown) => {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const canEdit = can(actor, "clients.edit");
  const canSettings = can(actor, "settings.edit");
  const connected = new Set(view.connectedSocial.map((account) => account.provider));
  const p = view.profile;

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/clients" className="hover:text-navy-800">
            Clients
          </Link>
          <span aria-hidden="true"> / </span>
          <Link href={`/admin/clients/${clientId}`} className="hover:text-navy-800">
            {view.client.name}
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">Onboarding</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Onboarding · {view.progress.percent}%</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          {view.completedAt ? `First completed ${WHEN.format(view.completedAt)}. ` : ""}
          Steps complete from what the client actually provides. Mark a step not needed when it does not apply to this client.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Steps</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="divide-y divide-line">
                {view.progress.steps.map((step) => (
                  <li key={step.step} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-navy-800">{step.label}</p>
                      <p className="text-2xs text-ink-subtle">{STEP_NEEDS[step.step]}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {step.state === "done" ? <Badge tone="success">Done</Badge> : step.state === "not-applicable" ? <Badge tone="neutral">Not needed</Badge> : <Badge tone="warning">To do</Badge>}
                      {canEdit && step.state !== "done" ? <NotApplicableToggle clientId={clientId} step={step.step} notApplicable={step.state === "not-applicable"} /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Company and business</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <Row label="Legal name" value={p.legalName} />
                <Row label="Industry" value={view.client.industry} />
                <Row label="Website" value={view.client.website} />
                <Row label="Tax ID" value={p.taxId} />
                <Row
                  label="Address"
                  value={
                    p.addressLine1
                      ? [p.addressLine1, p.addressLine2, p.city, p.region, p.postalCode, p.countryCode ? countryName(p.countryCode) : null].filter(Boolean).join(", ")
                      : null
                  }
                />
                <Row label="Public phone" value={p.publicPhone} />
                <Row label="Public email" value={p.publicEmail} />
                <Row
                  label="Hours"
                  value={
                    p.hours
                      ? WEEKDAYS.map((day) => `${day[0]!.toUpperCase()}${day.slice(1)} ${p.hours![day][0] ? `${p.hours![day][0]!.open}–${p.hours![day][0]!.close}` : "closed"}`).join(" · ")
                      : null
                  }
                />
                <Row label="Service areas" value={p.serviceAreas.length ? p.serviceAreas.join(", ") : null} />
                <Row label="Google Business" value={p.googleBusinessUrl} />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Access</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <Row label="Website platform" value={view.website.platform ? WEBSITE_PLATFORM_LABEL[view.website.platform] : null} />
                <Row label="Login page" value={view.website.loginUrl} />
                <Row label="Website access" value={view.website.confirmedAt ? `Confirmed ${WHEN.format(view.website.confirmedAt)}` : "Not confirmed"} />
                <Row label="Notes" value={view.website.notes} />
                <Row label="GA4 property" value={view.analytics.propertyId} />
                <Row label="GA4 access" value={view.analytics.confirmedAt ? `Confirmed ${WHEN.format(view.analytics.confirmedAt)}` : "Not confirmed"} />
                <Row
                  label="Search Console"
                  value={
                    view.searchConsole.length
                      ? view.searchConsole.map((property) => `${property.domain}: ${property.status === "CONNECTED" ? `connected (${property.siteUrl})` : property.status === "PENDING" ? "signed in, property not chosen" : property.status === "ERROR" ? "needs attention" : "not connected"}`).join(" · ")
                      : "No website yet"
                  }
                />
              </dl>
              {view.searchConsole[0] && can(actor, "seo.intelligence.view") ? (
                <Link href={`/admin/marketing/seo/properties/${view.searchConsole[0].id}/search-console`} className="mt-3 inline-block text-xs text-navy-800 underline underline-offset-2 hover:text-brand-red">
                  Open the Search Console connection
                </Link>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Brand</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {view.brandColors.length ? (
                <ul className="flex flex-wrap gap-2" aria-label="Brand colours">
                  {view.brandColors.map((color) => (
                    <li key={color} className="flex items-center gap-1.5 text-xs">
                      <span aria-hidden="true" className="inline-block size-4 rounded-sm border border-line" style={{ backgroundColor: color }} />
                      <span className="font-mono">{color}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-subtle">No colours yet.</p>
              )}
              {view.assets.length ? (
                <ul className="space-y-1 text-sm">
                  {view.assets.map((asset) => (
                    <li key={asset.id}>
                      <a href={asset.media.url} target="_blank" rel="noreferrer noopener" className="break-all text-navy-800 hover:text-brand-red">
                        {asset.media.filename}
                      </a>
                      <span className="ml-1 text-2xs text-ink-subtle">{asset.kind.toLowerCase()}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-subtle">No files uploaded.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Social profiles</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              {view.socialProfiles.length ? (
                <ul className="space-y-1 text-sm">
                  {view.socialProfiles.map((profile) => (
                    <li key={`${profile.platform}-${profile.handle}`} className="flex flex-wrap items-center gap-2">
                      <span className="text-navy-800">{SOCIAL_PLATFORM_LABEL[profile.platform as SocialPlatform]}</span>
                      <span className="break-all text-xs text-ink-muted">{profile.handle}</span>
                      {connected.has(profile.platform) ? <Badge tone="success">Connected</Badge> : <Badge tone="warning">Connect it</Badge>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-subtle">None listed yet.</p>
              )}
              {can(actor, "social.view") ? (
                <Link href={`/admin/clients/${clientId}/social/accounts`} className="inline-block text-xs text-navy-800 underline underline-offset-2 hover:text-brand-red">
                  Connect social accounts
                </Link>
              ) : null}
            </CardBody>
          </Card>

          {canSettings ? (
            <Card>
              <CardHeader>
                <CardTitle>Access email</CardTitle>
              </CardHeader>
              <CardBody>
                <AccessEmailForm email={view.accessEmail} />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
