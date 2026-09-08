"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Card, CardBody, Field, Input, Select } from "@/components/ui";
import {
  SOCIAL_LABELS,
  SOCIAL_PLATFORMS,
  type NavItemInput,
  type SocialLinkInput,
  type SocialPlatform,
} from "@/lib/validation/navigation";
import type { SiteNavigation } from "@/lib/services/navigation.service";
import { saveNavigationAction, type NavigationActionState } from "./actions";

/**
 * Settings → Navigation.
 *
 * Every field is controlled React state, and the lists are posted as JSON in a
 * hidden field. That is what lets a rejected save come back with the eight
 * links still on screen: an uncontrolled form is reset by React once its action
 * resolves, which for a list editor would mean retyping the lot because one
 * `href` had a typo.
 *
 * Errors arrive keyed by the path zod reported (`headerLinks.2.href`), so the
 * row that is wrong is the row that shows the message.
 */

function Submit({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || !ready}>
      {pending ? "Saving…" : "Save navigation"}
    </Button>
  );
}

function move<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(to, 0, moved);
  return next;
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line-strong text-ink-muted transition-colors hover:border-navy-300 hover:text-navy-800 disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:text-ink-muted"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function LinkList({
  legend,
  hint,
  name,
  items,
  onChange,
  max,
  errors,
}: {
  legend: string;
  hint: string;
  name: string;
  items: NavItemInput[];
  onChange: (next: NavItemInput[]) => void;
  max: number;
  errors: Record<string, string>;
}) {
  const patch = (index: number, changes: Partial<NavItemInput>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...changes } : item)));

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-navy-800">{legend}</legend>
      <p className="text-xs text-ink-subtle">{hint}</p>

      {/* One field carries the whole list; the inputs below are pure UI. */}
      <input type="hidden" name={name} value={JSON.stringify(items)} />

      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-xs text-ink-subtle">
          No links. This part of the {legend.toLowerCase()} will not be rendered.
        </p>
      ) : null}

      <ul className="space-y-2">
        {items.map((item, index) => {
          const labelError = errors[`${name}.${index}.label`];
          const hrefError = errors[`${name}.${index}.href`];
          const rowId = `${name}-${index}`;

          return (
            <li key={rowId} className="rounded-md border border-line bg-surface-muted p-3">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-40 flex-1">
                  <Field id={`${rowId}-label`} label="Label" error={labelError}>
                    {(aria) => (
                      <Input
                        {...aria}
                        value={item.label}
                        onChange={(event) => patch(index, { label: event.target.value })}
                      />
                    )}
                  </Field>
                </div>

                <div className="min-w-52 flex-[2]">
                  <Field id={`${rowId}-href`} label="Destination" error={hrefError}>
                    {(aria) => (
                      <Input
                        {...aria}
                        value={item.href}
                        onChange={(event) => patch(index, { href: event.target.value })}
                        placeholder="/services"
                      />
                    )}
                  </Field>
                </div>

                <div className="flex items-center gap-1 pt-6">
                  <label className="mr-2 flex items-center gap-1.5 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      checked={item.newTab}
                      onChange={(event) => patch(index, { newTab: event.target.checked })}
                      className="h-3.5 w-3.5 accent-brand-red"
                    />
                    New tab
                  </label>
                  <IconButton
                    label={`Move ${item.label || "link"} up`}
                    onClick={() => onChange(move(items, index, index - 1))}
                    disabled={index === 0}
                  >
                    <ArrowUp size={14} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Move ${item.label || "link"} down`}
                    onClick={() => onChange(move(items, index, index + 1))}
                    disabled={index === items.length - 1}
                  >
                    <ArrowDown size={14} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`Remove ${item.label || "link"}`}
                    onClick={() => onChange(items.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </IconButton>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <Button
        type="button"
        variant="secondary"
        onClick={() => onChange([...items, { label: "", href: "", newTab: false }])}
        disabled={items.length >= max}
      >
        <Plus size={14} aria-hidden="true" />
        Add link
      </Button>
      {items.length >= max ? (
        <p className="text-xs text-ink-subtle">That is the maximum of {max}.</p>
      ) : null}
    </fieldset>
  );
}

export function NavigationForm({ navigation }: { navigation: SiteNavigation }) {
  const [state, formAction] = useActionState<NavigationActionState, FormData>(
    saveNavigationAction,
    null,
  );

  /**
   * Saving waits for hydration.
   *
   * The lists are posted as JSON that only React writes, so a form submitted
   * before hydration would carry whatever the server rendered and silently
   * discard every row the editor had just typed. React's progressive
   * enhancement makes that submit possible, so the button is rendered disabled
   * and enabled once this component is alive.
   */
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => setReady(true), []);

  const errors = state && !state.ok ? state.fieldErrors : {};
  const err = (key: string) => errors[key];

  const [brandName, setBrandName] = React.useState(navigation.brandName);
  const [tagline, setTagline] = React.useState(navigation.tagline);
  const [contactEmail, setContactEmail] = React.useState(navigation.contactEmail);
  const [contactPhone, setContactPhone] = React.useState(navigation.contactPhone);
  const [contactAddress, setContactAddress] = React.useState(navigation.contactAddress);
  const [copyrightName, setCopyrightName] = React.useState(navigation.copyrightName);

  const [headerLinks, setHeaderLinks] = React.useState<NavItemInput[]>(navigation.headerLinks);
  const [ctaEnabled, setCtaEnabled] = React.useState(navigation.cta.enabled);
  const [ctaLabel, setCtaLabel] = React.useState(navigation.cta.label);
  const [ctaHref, setCtaHref] = React.useState(navigation.cta.href);

  /**
   * The button's fields are read-only while it is switched off, not disabled.
   * A disabled input is left out of the form payload entirely, so disabling
   * them would save the label and the destination as empty — and toggling the
   * button back on would find both fields blank.
   */
  const dimmed = ctaEnabled ? undefined : "bg-surface-sunken text-ink-subtle";

  const [companyLinks, setCompanyLinks] = React.useState<NavItemInput[]>(
    navigation.footerCompanyLinks,
  );
  const [legalLinks, setLegalLinks] = React.useState<NavItemInput[]>(navigation.footerLegalLinks);
  const [socialLinks, setSocialLinks] = React.useState<SocialLinkInput[]>(navigation.socialLinks);

  const patchSocial = (index: number, changes: Partial<SocialLinkInput>) =>
    setSocialLinks(socialLinks.map((item, i) => (i === index ? { ...item, ...changes } : item)));

  // Offer each platform once: a footer with two "Instagram" links is a mistake,
  // not a feature.
  const unusedPlatform = SOCIAL_PLATFORMS.find(
    (platform) => !socialLinks.some((link) => link.platform === platform),
  );

  return (
    <form action={formAction} className="max-w-3xl space-y-6" noValidate>
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
          Navigation saved. The public site is showing it now.
        </div>
      ) : null}

      <Card>
        <CardBody className="space-y-5">
          <h2 className="font-display text-lg text-navy-800">Identity</h2>

          <Field id="brandName" label="Site name" error={err("brandName")}>
            {(aria) => (
              <Input
                {...aria}
                name="brandName"
                value={brandName}
                onChange={(event) => setBrandName(event.target.value)}
              />
            )}
          </Field>

          <Field
            id="tagline"
            label="Footer tagline"
            error={err("tagline")}
            hint="One line under the site name in the footer. Leave blank to hide it."
          >
            {(aria) => (
              <Input
                {...aria}
                name="tagline"
                value={tagline}
                onChange={(event) => setTagline(event.target.value)}
              />
            )}
          </Field>

          <Field
            id="copyrightName"
            label="Copyright name"
            error={err("copyrightName")}
            hint="Follows the year in the footer’s “All rights reserved” line."
          >
            {(aria) => (
              <Input
                {...aria}
                name="copyrightName"
                value={copyrightName}
                onChange={(event) => setCopyrightName(event.target.value)}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-5">
          <h2 className="font-display text-lg text-navy-800">Header</h2>

          <LinkList
            legend="Main menu"
            hint="Shown across the top on desktop and in the mobile menu, in this order."
            name="headerLinks"
            items={headerLinks}
            onChange={setHeaderLinks}
            max={8}
            errors={errors}
          />

          <div className="space-y-4 border-t border-line pt-5">
            <label className="flex items-center gap-2 text-sm text-navy-800">
              <input
                type="checkbox"
                name="ctaEnabled"
                checked={ctaEnabled}
                onChange={(event) => setCtaEnabled(event.target.checked)}
                className="h-4 w-4 accent-brand-red"
              />
              Show the call-to-action button
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ctaLabel" label="Button label" error={err("ctaLabel")}>
                {(aria) => (
                  <Input
                    {...aria}
                    name="ctaLabel"
                    value={ctaLabel}
                    onChange={(event) => setCtaLabel(event.target.value)}
                    readOnly={!ctaEnabled}
                    className={dimmed}
                  />
                )}
              </Field>
              <Field id="ctaHref" label="Button destination" error={err("ctaHref")}>
                {(aria) => (
                  <Input
                    {...aria}
                    name="ctaHref"
                    value={ctaHref}
                    onChange={(event) => setCtaHref(event.target.value)}
                    placeholder="/contact"
                    readOnly={!ctaEnabled}
                    className={dimmed}
                  />
                )}
              </Field>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-6">
          <h2 className="font-display text-lg text-navy-800">Footer</h2>
          <p className="-mt-4 text-xs text-ink-subtle">
            The Services column is generated from what is published and is not edited here.
          </p>

          <LinkList
            legend="Company column"
            hint="The second editable column of the footer."
            name="footerCompanyLinks"
            items={companyLinks}
            onChange={setCompanyLinks}
            max={10}
            errors={errors}
          />

          <LinkList
            legend="Legal links"
            hint="The small links beside the copyright line."
            name="footerLegalLinks"
            items={legalLinks}
            onChange={setLegalLinks}
            max={6}
            errors={errors}
          />

          <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
            <Field id="contactEmail" label="Contact email" error={err("contactEmail")}>
              {(aria) => (
                <Input
                  {...aria}
                  name="contactEmail"
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                />
              )}
            </Field>
            <Field id="contactPhone" label="Contact phone" error={err("contactPhone")}>
              {(aria) => (
                <Input
                  {...aria}
                  name="contactPhone"
                  value={contactPhone}
                  onChange={(event) => setContactPhone(event.target.value)}
                />
              )}
            </Field>
            <div className="sm:col-span-2">
              <Field
                id="contactAddress"
                label="Address"
                error={err("contactAddress")}
                hint="Blank fields are left out of the footer rather than shown empty."
              >
                {(aria) => (
                  <Input
                    {...aria}
                    name="contactAddress"
                    value={contactAddress}
                    onChange={(event) => setContactAddress(event.target.value)}
                  />
                )}
              </Field>
            </div>
          </div>

          <fieldset className="space-y-3 border-t border-line pt-5">
            <legend className="text-sm font-medium text-navy-800">Social profiles</legend>
            <p className="text-xs text-ink-subtle">
              Full https:// addresses. Each platform can be listed once.
            </p>
            <input type="hidden" name="socialLinks" value={JSON.stringify(socialLinks)} />

            <ul className="space-y-2">
              {socialLinks.map((social, index) => {
                const urlError = err(`socialLinks.${index}.url`);
                return (
                  <li
                    key={social.platform}
                    className="flex flex-wrap items-start gap-2 rounded-md border border-line bg-surface-muted p-3"
                  >
                    <div className="min-w-36">
                      <Field id={`social-${index}-platform`} label="Platform">
                        {(aria) => (
                          <Select
                            {...aria}
                            value={social.platform}
                            onChange={(event) =>
                              patchSocial(index, {
                                platform: event.target.value as SocialPlatform,
                              })
                            }
                          >
                            {SOCIAL_PLATFORMS.filter(
                              (platform) =>
                                platform === social.platform ||
                                !socialLinks.some((link) => link.platform === platform),
                            ).map((platform) => (
                              <option key={platform} value={platform}>
                                {SOCIAL_LABELS[platform]}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </div>

                    <div className="min-w-52 flex-1">
                      <Field id={`social-${index}-url`} label="Profile URL" error={urlError}>
                        {(aria) => (
                          <Input
                            {...aria}
                            value={social.url}
                            onChange={(event) => patchSocial(index, { url: event.target.value })}
                            placeholder="https://www.linkedin.com/company/…"
                          />
                        )}
                      </Field>
                    </div>

                    <div className="pt-6">
                      <IconButton
                        label={`Remove ${SOCIAL_LABELS[social.platform]}`}
                        onClick={() => setSocialLinks(socialLinks.filter((_, i) => i !== index))}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ul>

            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                unusedPlatform
                  ? setSocialLinks([...socialLinks, { platform: unusedPlatform, url: "" }])
                  : undefined
              }
              disabled={!unusedPlatform}
            >
              <Plus size={14} aria-hidden="true" />
              Add profile
            </Button>
          </fieldset>
        </CardBody>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {ready ? null : (
          <p className="text-xs text-ink-subtle" role="status">
            Preparing the editor…
          </p>
        )}
        <Submit ready={ready} />
      </div>
    </form>
  );
}
