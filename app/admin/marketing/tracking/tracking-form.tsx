"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button, Card, CardBody, Field, Input, Select, Textarea } from "@/components/ui";
import type { AdminTrackingSettings } from "@/lib/services/tracking.service";
import { saveTrackingSettingsAction, type TrackingActionState } from "./actions";

/**
 * Tracking settings form.
 *
 * One form, saved as a unit, because the validation has cross-field rules — a
 * conversion label needs a conversion ID, a toggle needs something to send.
 * Splitting it per provider would mean each card could be saved into a state
 * the schema rejects.
 *
 * The Conversions API token is deliberately not here. It lives in its own form
 * so a secret is never a hidden field re-posted every time someone edits an
 * unrelated toggle.
 */

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save tracking settings"}
    </Button>
  );
}

function Toggle({
  name,
  defaultChecked,
  children,
}: {
  name: string;
  defaultChecked: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-navy-800">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-[var(--color-brand-red)]"
      />
      {children}
    </label>
  );
}

function Provider({
  title,
  description,
  toggleName,
  enabled,
  children,
}: {
  title: string;
  description: string;
  toggleName: string;
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardBody className="space-y-4">
        <div>
          <h3 className="font-display text-sm text-navy-800">{title}</h3>
          <p className="mt-1 text-xs text-ink-subtle">{description}</p>
        </div>
        {children}
        <Toggle name={toggleName} defaultChecked={enabled}>
          Load on the public site
        </Toggle>
      </CardBody>
    </Card>
  );
}

export function TrackingForm({ settings }: { settings: AdminTrackingSettings }) {
  const [state, formAction] = useActionState<TrackingActionState, FormData>(
    saveTrackingSettingsAction,
    null,
  );
  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  /**
   * What to show in each field.
   *
   * React resets an uncontrolled form once its action resolves, so after a
   * rejected save the stored settings would reappear and the corrections would
   * be gone. When the action sent the submitted values back, those win.
   */
  const submitted = state && !state.ok ? state.values : undefined;
  const text = (name: string, stored: string | null) => submitted?.[name] ?? stored ?? "";
  const flag = (name: string, stored: boolean) =>
    submitted ? submitted[name] === "on" : stored;

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state && !state.ok ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
        >
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      ) : null}

      {state?.ok ? (
        <div
          role="status"
          className="rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
        >
          Saved. The public site picks this up on its next request.
        </div>
      ) : null}

      <section aria-labelledby="group-google" className="space-y-3">
        <h2 id="group-google" className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Google
        </h2>

        <Provider
          title="Google Tag Manager"
          description="When a container is loaded, GA4 and Google Ads are left to the container — the site will not also load them directly, so no tag fires twice."
          toggleName="gtmEnabled"
          enabled={flag("gtmEnabled", settings.gtmEnabled)}
        >
          <Field id="gtmId" label="Container ID" hint="e.g. GTM-ABC1234" error={err("gtmId")}>
            {(aria) => (
              <Input {...aria} name="gtmId" defaultValue={text("gtmId", settings.gtmId)} placeholder="GTM-" />
            )}
          </Field>
        </Provider>

        <Provider
          title="Google Analytics 4"
          description="Loaded directly only when Tag Manager is off."
          toggleName="ga4Enabled"
          enabled={flag("ga4Enabled", settings.ga4Enabled)}
        >
          <Field id="ga4Id" label="Measurement ID" hint="e.g. G-AB12CD34EF" error={err("ga4Id")}>
            {(aria) => (
              <Input {...aria} name="ga4Id" defaultValue={text("ga4Id", settings.ga4Id)} placeholder="G-" />
            )}
          </Field>
        </Provider>

        <Provider
          title="Google Ads"
          description="Conversion ID and, optionally, the label for the conversion action you want recorded."
          toggleName="googleAdsEnabled"
          enabled={flag("googleAdsEnabled", settings.googleAdsEnabled)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="googleAdsId"
              label="Conversion ID"
              hint="e.g. AW-123456789"
              error={err("googleAdsId")}
            >
              {(aria) => (
                <Input
                  {...aria}
                  name="googleAdsId"
                  defaultValue={text("googleAdsId", settings.googleAdsId)}
                  placeholder="AW-"
                />
              )}
            </Field>
            <Field id="googleAdsLabel" label="Conversion label" error={err("googleAdsLabel")}>
              {(aria) => (
                <Input
                  {...aria}
                  name="googleAdsLabel"
                  defaultValue={text("googleAdsLabel", settings.googleAdsLabel)}
                />
              )}
            </Field>
          </div>
          <Toggle name="googleAdsLabelEnabled" defaultChecked={flag("googleAdsLabelEnabled", settings.googleAdsLabelEnabled)}>
            Send the conversion label with lead submissions
          </Toggle>
        </Provider>

        <Provider
          title="Search Console verification"
          description="Renders a verification meta tag in the head of every public page."
          toggleName="googleSiteVerificationEnabled"
          enabled={flag("googleSiteVerificationEnabled", settings.googleSiteVerificationEnabled)}
        >
          <Field
            id="googleSiteVerification"
            label="Verification content"
            hint="Paste only the content value, not the whole <meta> tag."
            error={err("googleSiteVerification")}
          >
            {(aria) => (
              <Input
                {...aria}
                name="googleSiteVerification"
                defaultValue={text("googleSiteVerification", settings.googleSiteVerification)}
              />
            )}
          </Field>
        </Provider>
      </section>

      <section aria-labelledby="group-meta" className="space-y-3">
        <h2 id="group-meta" className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Meta
        </h2>

        <Provider
          title="Meta Pixel"
          description="The browser-side pixel. The same ID is used by the Conversions API below."
          toggleName="metaPixelEnabled"
          enabled={flag("metaPixelEnabled", settings.metaPixelEnabled)}
        >
          <Field id="metaPixelId" label="Pixel ID" hint="15 or 16 digits" error={err("metaPixelId")}>
            {(aria) => (
              <Input {...aria} name="metaPixelId" defaultValue={text("metaPixelId", settings.metaPixelId)} inputMode="numeric" />
            )}
          </Field>
        </Provider>

        <Card>
          <CardBody className="space-y-4">
            <div>
              <h3 className="font-display text-sm text-navy-800">Conversions API</h3>
              <p className="mt-1 text-xs text-ink-subtle">
                Sends purchases from the server as well as the browser, sharing one event ID so Meta
                counts them once. Needs the pixel ID above and an access token, saved separately.
              </p>
            </div>
            <Toggle name="capiPurchasesEnabled" defaultChecked={flag("capiPurchasesEnabled", settings.capiPurchasesEnabled)}>
              Send purchases server-side
            </Toggle>
          </CardBody>
        </Card>
      </section>

      <section aria-labelledby="group-behaviour" className="space-y-3">
        <h2
          id="group-behaviour"
          className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle"
        >
          Behaviour
        </h2>

        <Provider
          title="Microsoft Clarity"
          description="Session recordings and heatmaps."
          toggleName="clarityEnabled"
          enabled={flag("clarityEnabled", settings.clarityEnabled)}
        >
          <Field id="clarityId" label="Project ID" error={err("clarityId")}>
            {(aria) => <Input {...aria} name="clarityId" defaultValue={text("clarityId", settings.clarityId)} />}
          </Field>
        </Provider>

        <Provider
          title="Hotjar"
          description="Session recordings, heatmaps and on-site surveys."
          toggleName="hotjarEnabled"
          enabled={flag("hotjarEnabled", settings.hotjarEnabled)}
        >
          <Field id="hotjarId" label="Site ID" hint="6 to 9 digits" error={err("hotjarId")}>
            {(aria) => (
              <Input {...aria} name="hotjarId" defaultValue={text("hotjarId", settings.hotjarId)} inputMode="numeric" />
            )}
          </Field>
        </Provider>
      </section>

      <section aria-labelledby="group-social" className="space-y-3">
        <h2 id="group-social" className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Social
        </h2>

        <Provider
          title="Pinterest Tag"
          description="Conversion tracking for Pinterest campaigns."
          toggleName="pinterestEnabled"
          enabled={flag("pinterestEnabled", settings.pinterestEnabled)}
        >
          <Field id="pinterestId" label="Tag ID" hint="13 digits" error={err("pinterestId")}>
            {(aria) => (
              <Input {...aria} name="pinterestId" defaultValue={text("pinterestId", settings.pinterestId)} inputMode="numeric" />
            )}
          </Field>
        </Provider>

        <Provider
          title="TikTok Pixel"
          description="Conversion tracking for TikTok campaigns."
          toggleName="tiktokEnabled"
          enabled={flag("tiktokEnabled", settings.tiktokEnabled)}
        >
          <Field id="tiktokId" label="Pixel ID" hint="20 characters" error={err("tiktokId")}>
            {(aria) => <Input {...aria} name="tiktokId" defaultValue={text("tiktokId", settings.tiktokId)} />}
          </Field>
        </Provider>

        <Provider
          title="Snap Pixel"
          description="Conversion tracking for Snapchat campaigns."
          toggleName="snapchatEnabled"
          enabled={flag("snapchatEnabled", settings.snapchatEnabled)}
        >
          <Field id="snapchatId" label="Pixel ID" hint="A UUID" error={err("snapchatId")}>
            {(aria) => <Input {...aria} name="snapchatId" defaultValue={text("snapchatId", settings.snapchatId)} />}
          </Field>
        </Provider>
      </section>

      <section aria-labelledby="group-consent" className="space-y-3">
        <h2 id="group-consent" className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Consent
        </h2>

        <Card>
          <CardBody className="space-y-4">
            <p className="text-xs text-ink-subtle">
              Consent gates the scripts above: analytics and marketing tags are held back until the
              rule below is satisfied. Changing the mode or the wording asks every visitor again,
              because what they agreed to is no longer what is being asked.
            </p>

            <Field
              id="consentMode"
              label="Mode"
              hint="Opt-in is required for visitors in the EU and UK."
              error={err("consentMode")}
            >
              {(aria) => (
                <Select {...aria} name="consentMode" defaultValue={submitted?.["consentMode"] ?? settings.consentMode}>
                  <option value="IMPLIED">Implied — load immediately, no banner</option>
                  <option value="OPT_OUT">Opt-out — load immediately, offer a way to refuse</option>
                  <option value="OPT_IN">Opt-in — load nothing until the visitor agrees</option>
                </Select>
              )}
            </Field>

            <Field
              id="consentBannerText"
              label="Banner wording"
              hint="Shown in opt-in and opt-out mode. Leave blank for the default."
              error={err("consentBannerText")}
            >
              {(aria) => (
                <Textarea
                  {...aria}
                  name="consentBannerText"
                  rows={3}
                  defaultValue={text("consentBannerText", settings.consentBannerText)}
                />
              )}
            </Field>
          </CardBody>
        </Card>
      </section>

      <div className="flex gap-2 border-t border-line pt-5">
        <Submit />
      </div>
    </form>
  );
}
