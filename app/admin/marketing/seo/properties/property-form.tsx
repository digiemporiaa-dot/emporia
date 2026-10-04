"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { INTERNAL_OWNER } from "@/lib/validation/seo-intel";
import { savePropertyAction, type PropertyActionState } from "./actions";

/** Adding or editing the website a client's SEO Intelligence is about. */

export type PropertyValues = {
  id: string;
  clientName: string;
  clientId: string;
  website: string;
  protocol: "HTTPS" | "HTTP";
  displayName: string;
  projectId: string | null;
  defaultCountry: string | null;
  defaultLanguage: string;
  timezone: string;
  isActive: boolean;
  crawlMaxPages: number;
  crawlFrequency: "WEEKLY" | "MANUAL";
};

type Option = { id: string; name: string };
type ProjectOption = { id: string; code: string; name: string; clientId: string };


export function PropertyForm({
  property,
  clients,
  internal,
  projects,
  countries,
  timeZones,
}: {
  property?: PropertyValues;
  clients: readonly Option[];
  /** The agency's own client record, when it exists already. */
  internal: Option | null;
  projects: readonly ProjectOption[];
  countries: readonly { code: string; name: string }[];
  timeZones: readonly string[];
}) {
  const [state, formAction, pending] = useActionState<PropertyActionState, FormData>(savePropertyAction, null);
  // Submitted by hand rather than through `<form action>`, which resets every
  // field after the action returns — a validation error would then wipe what
  // was typed.
  const [, startTransition] = React.useTransition();
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };
  const [owner, setOwner] = React.useState<string>(property?.clientId ?? "");
  // A new property starts in the browser's own zone; the server validates it.
  const [timezone, setTimezone] = React.useState<string>(property?.timezone ?? "UTC");
  React.useEffect(() => {
    if (property) return;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && timeZones.includes(zone)) setTimezone(zone);
  }, [property, timeZones]);

  const fieldErrors = (state && !state.ok ? state.details : null) as Record<string, string[]> | null | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  // The projects of whichever client owns it: the internal client's when the
  // agency's own site is chosen.
  const ownerClientId = owner === INTERNAL_OWNER ? (internal?.id ?? null) : owner || null;
  const ownerProjects = ownerClientId ? projects.filter((project) => project.clientId === ownerClientId) : [];

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {property ? <input type="hidden" name="id" value={property.id} /> : null}

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
        <div role="status" className="rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success">
          Saved.{" "}
          {property ? null : (
            <Link href={`/admin/marketing/seo?property=${state.data.id}`} className="font-medium underline underline-offset-2">
              Open its overview
            </Link>
          )}
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        {property ? (
          <Field id="owner" label="Whose website" hint="Fixed once created — a property's history stays with its client.">
            {(aria) => <Input {...aria} value={property.clientName} disabled readOnly />}
          </Field>
        ) : (
          <Field id="owner" label="Whose website" required error={err("owner")}>
            {(aria) => (
              <Select {...aria} name="owner" value={owner} onChange={(event) => setOwner(event.target.value)} required>
                <option value="">Choose a client</option>
                <option value={INTERNAL_OWNER}>{internal ? `${internal.name} (our own website)` : "Our own website"}</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field id="displayName" label="Name" required error={err("displayName")} hint="How it appears in lists, e.g. “Acme — main site”.">
          {(aria) => <Input {...aria} name="displayName" defaultValue={property?.displayName} maxLength={120} required />}
        </Field>

        <Field id="website" label="Website" required error={err("website")} hint="The domain, such as example.com. A path is ignored.">
          {(aria) => (
            <Input
              {...aria}
              name="website"
              defaultValue={property?.website}
              placeholder="example.com"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={300}
              required
            />
          )}
        </Field>

        <Field id="protocol" label="Protocol" error={err("protocol")} hint="Used when the website is typed without http(s)://.">
          {(aria) => (
            <Select {...aria} name="protocol" defaultValue={property?.protocol ?? "HTTPS"}>
              <option value="HTTPS">https://</option>
              <option value="HTTP">http://</option>
            </Select>
          )}
        </Field>

        <Field
          id="projectId"
          label="Project for SEO tasks"
          error={err("projectId")}
          hint={ownerClientId || property ? "Where opportunities become tasks. Optional." : "Choose whose website it is first."}
        >
          {(aria) => (
            <Select {...aria} name="projectId" defaultValue={property?.projectId ?? ""} key={ownerClientId ?? "none"}>
              <option value="">None yet</option>
              {(property ? projects.filter((project) => project.clientId === property.clientId) : ownerProjects).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} — {project.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="defaultCountry" label="Main market" error={err("defaultCountry")} hint="The country most of its searches come from. Optional.">
          {(aria) => (
            <Select {...aria} name="defaultCountry" defaultValue={property?.defaultCountry ?? ""}>
              <option value="">Not set</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="defaultLanguage" label="Main language" required error={err("defaultLanguage")} hint="A language code: en, en-IN, ar, hi…">
          {(aria) => (
            <Input {...aria} name="defaultLanguage" defaultValue={property?.defaultLanguage ?? "en"} maxLength={35} spellCheck={false} required />
          )}
        </Field>

        <Field id="timezone" label="Time zone" required error={err("timezone")} hint="How the client's days are labelled.">
          {(aria) => (
            <Select {...aria} name="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              {timeZones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <fieldset className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <legend className="sr-only">Site crawl</legend>
        <Field id="crawlFrequency" label="Site crawl" error={err("crawlFrequency")} hint="Weekly crawls run on the schedule; staff can also crawl any time.">
          {(aria) => (
            <Select {...aria} name="crawlFrequency" defaultValue={property?.crawlFrequency ?? "WEEKLY"}>
              <option value="WEEKLY">Weekly, and on demand</option>
              <option value="MANUAL">Only on demand</option>
            </Select>
          )}
        </Field>
        <Field id="crawlMaxPages" label="Pages per crawl" error={err("crawlMaxPages")} hint="10 to 5,000. Larger sites take longer and load the client's server more.">
          {(aria) => (
            <Input {...aria} name="crawlMaxPages" type="number" inputMode="numeric" min={10} max={5000} step={1} defaultValue={property?.crawlMaxPages ?? 500} />
          )}
        </Field>
      </fieldset>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="isActive" defaultChecked={property?.isActive ?? true} className="size-4 accent-navy-800" />
        Active — included in syncs and dashboards
      </label>

      <div className="flex justify-end gap-2">
        <Link href="/admin/marketing/seo/properties" className="inline-flex items-center px-3 text-sm text-ink-muted hover:text-navy-800">
          Cancel
        </Link>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : property ? "Save website" : "Add website"}
        </Button>
      </div>
    </form>
  );
}
