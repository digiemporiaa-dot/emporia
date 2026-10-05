"use client";

import { Field, Input, Textarea } from "@/components/ui";
import { ActionForm } from "../action-form";
import { saveGoogleSettingsAction } from "../actions";
import type { SafeGoogleSettings } from "@/lib/services/seo-intel/google-settings.service";

/** The agency's Google credentials. Secrets are write-only: blank keeps what is stored. */
export function GoogleSettingsForm({ settings }: { settings: SafeGoogleSettings }) {
  return (
    <ActionForm action={saveGoogleSettingsAction} label="Save Google settings" pendingLabel="Saving…" className="space-y-6">
      <fieldset className="space-y-4">
        <legend className="font-display text-base text-navy-800">Sign in with Google (OAuth)</legend>
        <p className="text-xs text-ink-subtle">
          Create an OAuth client of type “Web application” in Google Cloud, enable the Search Console API, and add this
          authorised redirect URI:{" "}
          <code className="break-all rounded-xs bg-surface-muted px-1 py-0.5 font-mono text-2xs text-navy-800">{settings.callbackUrl}</code>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="oauthClientId" label="Client ID">
            {(aria) => <Input {...aria} name="oauthClientId" defaultValue={settings.oauthClientId ?? ""} placeholder="….apps.googleusercontent.com" spellCheck={false} autoComplete="off" />}
          </Field>
          <Field
            id="oauthClientSecret"
            label="Client secret"
            hint={
              settings.oauthSecretUnreadable
                ? "A secret is stored but can no longer be read (the app secret changed). Enter it again."
                : settings.oauthSecretConfigured
                  ? "A secret is stored. Leave blank to keep it."
                  : undefined
            }
          >
            {(aria) => <Input {...aria} name="oauthClientSecret" type="password" autoComplete="new-password" />}
          </Field>
        </div>
        {settings.oauthClientId ? (
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" name="removeOAuth" className="size-4 accent-navy-800" /> Remove the OAuth client
          </label>
        ) : null}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-display text-base text-navy-800">Service account</legend>
        <p className="text-xs text-ink-subtle">
          For clients who would rather add one address to their Search Console than sign in. Create a service account
          in Google Cloud, add a JSON key, and paste the whole file here. The private key is encrypted and never shown
          again.
        </p>
        {settings.serviceAccountEmail ? (
          <p className="text-sm text-navy-800">
            Current account: <code className="break-all font-mono text-xs">{settings.serviceAccountEmail}</code>
            {settings.serviceAccountKeyUnreadable ? (
              <span className="ml-2 text-xs text-brand-red-text">The stored key can no longer be read — paste it again.</span>
            ) : null}
          </p>
        ) : null}
        <Field id="serviceAccountJson" label={settings.serviceAccountEmail ? "Replace the key file" : "Key file (JSON)"} hint="Leave blank to keep the current key.">
          {(aria) => <Textarea {...aria} name="serviceAccountJson" rows={4} spellCheck={false} autoComplete="off" className="font-mono text-2xs" placeholder='{ "type": "service_account", … }' />}
        </Field>
        {settings.serviceAccountEmail ? (
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" name="removeServiceAccount" className="size-4 accent-navy-800" /> Remove the service account
          </label>
        ) : null}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="font-display text-base text-navy-800">Core Web Vitals (Chrome UX Report)</legend>
        <p className="text-xs text-ink-subtle">
          Page speed as real Chrome users experienced it. Enable the Chrome UX Report API in Google Cloud, create an API key
          restricted to that API, and paste it here. Without a key, page speed shows as not configured. The key is
          encrypted and never shown again.
        </p>
        <Field
          id="cruxApiKey"
          label="API key"
          hint={
            settings.cruxKeyUnreadable
              ? "A key is stored but can no longer be read (the app secret changed). Enter it again."
              : settings.cruxKeyConfigured
                ? "A key is stored. Leave blank to keep it."
                : undefined
          }
        >
          {(aria) => <Input {...aria} name="cruxApiKey" type="password" autoComplete="new-password" spellCheck={false} />}
        </Field>
        {settings.cruxKeyConfigured ? (
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" name="removeCruxKey" className="size-4 accent-navy-800" /> Remove the API key
          </label>
        ) : null}
      </fieldset>
    </ActionForm>
  );
}
