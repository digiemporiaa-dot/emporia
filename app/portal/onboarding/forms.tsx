"use client";

import * as React from "react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { SOCIAL_PLATFORMS, SOCIAL_PLATFORM_LABEL, WEBSITE_PLATFORMS, WEBSITE_PLATFORM_LABEL, WEEKDAYS, type OpeningHours } from "@/lib/validation/onboarding";
import { StepForm } from "./step-form";
import {
  chooseSiteAction,
  removeBrandAction,
  saveAnalyticsAction,
  saveBrandColorsAction,
  saveBusinessAction,
  saveCompanyAction,
  saveSocialAction,
  saveWebsiteAction,
} from "./actions";

/** The portal onboarding forms. Plain data in; each submits to its own action. */

type Country = { code: string; name: string };

export function CompanyForm({
  values,
  countries,
}: {
  values: {
    legalName: string | null;
    industry: string | null;
    website: string | null;
    taxId: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    countryCode: string | null;
  };
  countries: readonly Country[];
}) {
  return (
    <StepForm action={saveCompanyAction}>
      {(errors) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="legalName" label="Registered company name" error={errors["legalName"]}>
            {(aria) => <Input {...aria} name="legalName" defaultValue={values.legalName ?? ""} maxLength={160} />}
          </Field>
          <Field id="industry" label="Industry" error={errors["industry"]}>
            {(aria) => <Input {...aria} name="industry" defaultValue={values.industry ?? ""} maxLength={120} placeholder="e.g. Real estate" />}
          </Field>
          <Field id="website" label="Website" error={errors["website"]} hint="Your main website, e.g. example.com.">
            {(aria) => <Input {...aria} name="website" defaultValue={values.website ?? ""} inputMode="url" spellCheck={false} />}
          </Field>
          <Field id="taxId" label="Tax ID (GST / VAT / TRN)" error={errors["taxId"]} hint="Optional — for invoices.">
            {(aria) => <Input {...aria} name="taxId" defaultValue={values.taxId ?? ""} maxLength={40} />}
          </Field>
          <Field id="addressLine1" label="Address" error={errors["addressLine1"]}>
            {(aria) => <Input {...aria} name="addressLine1" defaultValue={values.addressLine1 ?? ""} maxLength={200} />}
          </Field>
          <Field id="addressLine2" label="Address line 2" error={errors["addressLine2"]}>
            {(aria) => <Input {...aria} name="addressLine2" defaultValue={values.addressLine2 ?? ""} maxLength={200} />}
          </Field>
          <Field id="city" label="City" error={errors["city"]}>
            {(aria) => <Input {...aria} name="city" defaultValue={values.city ?? ""} maxLength={100} />}
          </Field>
          <Field id="region" label="State / region / emirate" error={errors["region"]}>
            {(aria) => <Input {...aria} name="region" defaultValue={values.region ?? ""} maxLength={100} />}
          </Field>
          <Field id="postalCode" label="Postal code" error={errors["postalCode"]}>
            {(aria) => <Input {...aria} name="postalCode" defaultValue={values.postalCode ?? ""} maxLength={20} />}
          </Field>
          <Field id="countryCode" label="Country" error={errors["countryCode"]}>
            {(aria) => (
              <Select {...aria} name="countryCode" defaultValue={values.countryCode ?? ""}>
                <option value="">Choose a country</option>
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}
    </StepForm>
  );
}

export function BrandColorsForm({ colors }: { colors: string[] }) {
  return (
    <StepForm action={saveBrandColorsAction} label="Save colours">
      {(errors) => (
        <Field id="colors" label="Brand colours" error={errors["colors"]} hint="Hex values separated by commas, e.g. #002A3A, #DF1F38.">
          {(aria) => <Input {...aria} name="colors" defaultValue={colors.join(", ")} spellCheck={false} />}
        </Field>
      )}
    </StepForm>
  );
}

export function RemoveAssetButton({ assetId, filename }: { assetId: string; filename: string }) {
  return (
    <StepForm action={removeBrandAction} label="Remove" hidden={{ assetId }}>
      {() => <span className="sr-only">Remove {filename}</span>}
    </StepForm>
  );
}

export function WebsiteForm({
  values,
  accessEmail,
}: {
  values: { platform: string | null; loginUrl: string | null; notes: string | null; confirmed: boolean };
  accessEmail: string | null;
}) {
  return (
    <StepForm action={saveWebsiteAction}>
      {(errors) => (
        <>
          <p className="rounded-md border border-line bg-surface-muted px-3.5 py-3 text-sm text-ink-muted">
            We never ask for your password. Instead, add{" "}
            {accessEmail ? <strong className="break-all text-navy-800">{accessEmail}</strong> : "the email address your account manager gives you"} as a user
            (administrator or editor) on your website, then confirm below.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="platform" label="Website platform" error={errors["platform"]}>
              {(aria) => (
                <Select {...aria} name="platform" defaultValue={values.platform ?? ""}>
                  <option value="">Choose one</option>
                  {WEBSITE_PLATFORMS.map((platform) => (
                    <option key={platform} value={platform}>
                      {WEBSITE_PLATFORM_LABEL[platform]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="loginUrl" label="Login page" error={errors["loginUrl"]} hint="Optional, e.g. https://example.com/wp-admin">
              {(aria) => <Input {...aria} name="loginUrl" defaultValue={values.loginUrl ?? ""} inputMode="url" spellCheck={false} />}
            </Field>
          </div>
          <Field id="notes" label="Anything we should know" error={errors["notes"]} hint="Optional. Never put a password here.">
            {(aria) => <Textarea {...aria} name="notes" rows={2} defaultValue={values.notes ?? ""} maxLength={1000} />}
          </Field>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" name="confirmed" defaultChecked={values.confirmed} className="mt-0.5 size-4 accent-navy-800" />
            I have added the agency as a user on our website.
          </label>
        </>
      )}
    </StepForm>
  );
}

export function AnalyticsForm({
  values,
  accessEmail,
  serviceAccountEmail,
}: {
  values: { propertyId: string | null; confirmed: boolean };
  accessEmail: string | null;
  serviceAccountEmail: string | null;
}) {
  const grantees = [accessEmail, serviceAccountEmail].filter(Boolean) as string[];
  return (
    <StepForm action={saveAnalyticsAction}>
      {(errors) => (
        <>
          <p className="rounded-md border border-line bg-surface-muted px-3.5 py-3 text-sm text-ink-muted">
            In Google Analytics, open Admin → Property access management and add{" "}
            {grantees.length ? grantees.map((email, i) => (
              <React.Fragment key={email}>
                {i ? " and " : ""}
                <strong className="break-all text-navy-800">{email}</strong>
              </React.Fragment>
            )) : "the email address your account manager gives you"}{" "}
            with the <em>Viewer</em> role. Then enter the property ID from Admin → Property settings.
          </p>
          <Field id="propertyId" label="GA4 property ID" error={errors["propertyId"]}>
            {(aria) => <Input {...aria} name="propertyId" defaultValue={values.propertyId ?? ""} inputMode="numeric" placeholder="123456789" className="max-w-xs" />}
          </Field>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" name="confirmed" defaultChecked={values.confirmed} className="mt-0.5 size-4 accent-navy-800" />
            I have given the agency Viewer access to this property.
          </label>
        </>
      )}
    </StepForm>
  );
}

export function SocialForm({ profiles }: { profiles: { platform: string; handle: string }[] }) {
  const rows = [...profiles, ...Array.from({ length: Math.max(3, 6 - profiles.length) }, () => ({ platform: "", handle: "" }))].slice(0, 12);
  return (
    <StepForm action={saveSocialAction} label="Save profiles">
      {(errors) => (
        <>
          <div className="space-y-2">
            {rows.map((row, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
                <label className="sr-only" htmlFor={`platform-${index}`}>
                  Platform {index + 1}
                </label>
                <Select id={`platform-${index}`} name={`platform-${index}`} defaultValue={row.platform}>
                  <option value="">Platform</option>
                  {SOCIAL_PLATFORMS.map((platform) => (
                    <option key={platform} value={platform}>
                      {SOCIAL_PLATFORM_LABEL[platform]}
                    </option>
                  ))}
                </Select>
                <label className="sr-only" htmlFor={`handle-${index}`}>
                  Handle or link {index + 1}
                </label>
                <Input id={`handle-${index}`} name={`handle-${index}`} defaultValue={row.handle} placeholder="@yourbrand or a link" maxLength={200} />
              </div>
            ))}
          </div>
          {errors["profiles"] ? <p className="text-xs text-brand-red-text">{errors["profiles"]}</p> : null}
        </>
      )}
    </StepForm>
  );
}

const DAY_LABEL: Record<(typeof WEEKDAYS)[number], string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

export function BusinessForm({
  values,
}: {
  values: { publicPhone: string | null; publicEmail: string | null; hours: OpeningHours | null; serviceAreas: string[]; googleBusinessUrl: string | null };
}) {
  return (
    <StepForm action={saveBusinessAction}>
      {(errors) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="publicPhone" label="Phone customers call" error={errors["publicPhone"]}>
              {(aria) => <Input {...aria} name="publicPhone" type="tel" defaultValue={values.publicPhone ?? ""} />}
            </Field>
            <Field id="publicEmail" label="Email customers write to" error={errors["publicEmail"]} hint="Optional.">
              {(aria) => <Input {...aria} name="publicEmail" type="email" defaultValue={values.publicEmail ?? ""} />}
            </Field>
            <Field id="googleBusinessUrl" label="Google Business Profile link" error={errors["googleBusinessUrl"]} hint="Optional.">
              {(aria) => <Input {...aria} name="googleBusinessUrl" defaultValue={values.googleBusinessUrl ?? ""} inputMode="url" spellCheck={false} />}
            </Field>
            <Field id="serviceAreas" label="Areas you serve" error={errors["serviceAreas"]} hint="Cities or regions, separated by commas.">
              {(aria) => <Input {...aria} name="serviceAreas" defaultValue={values.serviceAreas.join(", ")} />}
            </Field>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-navy-800">Opening hours</legend>
            <p className="text-2xs text-ink-subtle">Your address comes from Company details.</p>
            <div className="mt-2 space-y-1.5">
              {WEEKDAYS.map((day) => {
                const span = values.hours?.[day]?.[0];
                return (
                  <div key={day} className="flex flex-wrap items-center gap-2 text-sm">
                    <label className="flex w-32 items-center gap-2">
                      <input type="checkbox" name={`${day}-open`} defaultChecked={Boolean(span)} className="size-4 accent-navy-800" />
                      {DAY_LABEL[day]}
                    </label>
                    <label className="sr-only" htmlFor={`${day}-from`}>
                      {DAY_LABEL[day]} opens
                    </label>
                    <Input id={`${day}-from`} name={`${day}-from`} type="time" defaultValue={span?.open ?? "09:00"} className="w-32" />
                    <span className="text-ink-subtle">to</span>
                    <label className="sr-only" htmlFor={`${day}-to`}>
                      {DAY_LABEL[day]} closes
                    </label>
                    <Input id={`${day}-to`} name={`${day}-to`} type="time" defaultValue={span?.close ?? "18:00"} className="w-32" />
                  </div>
                );
              })}
            </div>
            {errors["hours"] ? <p className="mt-1 text-xs text-brand-red-text">{errors["hours"]}</p> : null}
          </fieldset>
        </>
      )}
    </StepForm>
  );
}

export function SiteChoiceForm({
  propertyId,
  domain,
  sites,
}: {
  propertyId: string;
  domain: string;
  sites: { siteUrl: string; permissionLevel: string; matches: boolean; usable: boolean }[];
}) {
  return (
    <StepForm action={chooseSiteAction} label="Use this property" hidden={{ propertyId }}>
      {() => (
        <fieldset className="space-y-1.5">
          <legend className="text-sm text-navy-800">Which Search Console property is {domain}?</legend>
          {sites.map((site, index) => {
            const ok = site.matches && site.usable;
            return (
              <label key={site.siteUrl} className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${ok ? "border-navy-300" : "border-line opacity-70"}`}>
                <input type="radio" name="siteUrl" value={site.siteUrl} defaultChecked={index === 0 && ok} disabled={!ok} className="mt-1 accent-navy-800" />
                <span className="min-w-0">
                  <span className="block break-all font-mono text-xs text-navy-800">{site.siteUrl}</span>
                  {!site.matches ? <span className="text-2xs text-ink-subtle">Not {domain}</span> : null}
                  {!site.usable ? <span className="text-2xs text-ink-subtle">Not verified for this Google account</span> : null}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
    </StepForm>
  );
}
