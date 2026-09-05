"use client";

import * as React from "react";
import { useTransition } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { AIDraft, AIError } from "@/components/admin/ai-draft";
import { draftContentAction, draftSEOAction } from "./actions";
import type { SEODraft } from "@/lib/validation/ai";

/** Drafting content and SEO copy. Both produce text to copy into the editor. */

const CHANNELS = [
  ["BLOG", "Blog"],
  ["LINKEDIN", "LinkedIn"],
  ["INSTAGRAM", "Instagram"],
  ["FACEBOOK", "Facebook"],
  ["YOUTUBE", "YouTube"],
  ["EMAIL", "Email"],
  ["ADS", "Ads"],
] as const;

export function ContentStudio({
  clients,
}: {
  clients: readonly { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = React.useState<{ model: string; text: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        start(async () => {
          setError(null);
          const result = await draftContentAction(formData);
          if (result.ok) setDraft({ model: result.data.model, text: result.data.data });
          else {
            setDraft(null);
            setError(result.message);
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="content-channel" label="Channel" required>
          {(aria) => (
            <Select {...aria} name="channel" defaultValue="BLOG">
              {CHANNELS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="content-client" label="For a client" hint="Leave blank for our own channels">
          {(aria) => (
            <Select {...aria} name="clientId" defaultValue="">
              <option value="">Our own</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field id="content-topic" label="Topic" required>
        {(aria) => (
          <Input {...aria} name="topic" placeholder="Why local service pages beat one national page" required />
        )}
      </Field>

      <Field id="content-notes" label="Direction" hint="Anything it should or should not say">
        {(aria) => <Textarea {...aria} name="notes" rows={2} />}
      </Field>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Drafting…" : "Draft it"}
      </Button>

      {error ? <AIError message={error} /> : null}

      {draft ? (
        <AIDraft model={draft.model} onDismiss={() => setDraft(null)}>
          <p className="whitespace-pre-line text-sm text-ink">{draft.text}</p>
        </AIDraft>
      ) : null}
    </form>
  );
}

export function SEOStudio({
  services,
  cities,
}: {
  services: readonly { id: string; name: string }[];
  cities: readonly { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = React.useState<{ model: string; data: SEODraft } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        start(async () => {
          setError(null);
          const result = await draftSEOAction(formData);
          if (result.ok) setDraft({ model: result.data.model, data: result.data.data });
          else {
            setDraft(null);
            setError(result.message);
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="seo-service" label="Service" required>
          {(aria) => (
            <Select {...aria} name="serviceId" defaultValue="" required>
              <option value="">Choose a service</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="seo-city" label="City" hint="Leave blank for the national page">
          {(aria) => (
            <Select {...aria} name="cityId" defaultValue="">
              <option value="">No city</option>
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field
        id="seo-notes"
        label="What we know about this market"
        hint="The more specific this is, the less generic the draft"
      >
        {(aria) => <Textarea {...aria} name="notes" rows={3} />}
      </Field>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Drafting…" : "Draft it"}
      </Button>

      {error ? <AIError message={error} /> : null}

      {draft ? (
        <AIDraft model={draft.model} onDismiss={() => setDraft(null)}>
          {/* The model's own verdict on whether it had enough to be specific.
              A local page without genuine local content is what canPublish()
              refuses, so this is surfaced rather than buried. */}
          {!draft.data.enoughLocalDetail ? (
            <p className="mb-2.5 rounded-md border border-warning/30 bg-warning-bg px-2.5 py-2 text-2xs text-warning">
              It says it did not have enough to be genuinely specific about this city.
              {draft.data.note ? ` "${draft.data.note}"` : ""} Publishing this as-is would be a thin
              page — add local detail above and draft again.
            </p>
          ) : null}

          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                Meta title ({draft.data.metaTitle.length} characters)
              </dt>
              <dd className="text-ink">{draft.data.metaTitle}</dd>
            </div>
            <div>
              <dt className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                Meta description ({draft.data.metaDescription.length} characters)
              </dt>
              <dd className="text-ink">{draft.data.metaDescription}</dd>
            </div>
            <div>
              <dt className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                Intro
              </dt>
              <dd className="whitespace-pre-line text-ink">{draft.data.intro}</dd>
            </div>
          </dl>
        </AIDraft>
      ) : null}
    </form>
  );
}
