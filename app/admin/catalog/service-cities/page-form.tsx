"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { saveServiceCityPageAction, type PageActionState } from "../actions";

type Option = { id: string; name: string };

type PageValues = {
  id: string;
  serviceId: string;
  cityId: string;
  localIntro: string | null;
  marketContext: string | null;
  industries: string[];
  positioning: string | null;
  ctaHeading: string | null;
  ctaBody: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  canonical: string | null;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function ServiceCityPageForm({
  services,
  cities,
  page,
}: {
  services: readonly Option[];
  cities: readonly Option[];
  page?: PageValues;
}) {
  const [state, formAction] = useActionState<PageActionState, FormData>(
    saveServiceCityPageAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {page ? <input type="hidden" name="id" value={page.id} /> : null}

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
          Saved.
        </div>
      ) : null}

      <fieldset className="space-y-5">
        <legend className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Combination
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="serviceId" label="Service" required>
            {(aria) => (
              <Select {...aria} name="serviceId" defaultValue={page?.serviceId ?? ""} required disabled={Boolean(page)}>
                <option value="">Choose a service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="cityId" label="City" required>
            {(aria) => (
              <Select {...aria} name="cityId" defaultValue={page?.cityId ?? ""} required disabled={Boolean(page)}>
                <option value="">Choose a city</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        {page ? (
          <>
            <input type="hidden" name="serviceId" value={page.serviceId} />
            <input type="hidden" name="cityId" value={page.cityId} />
            <p className="text-xs text-ink-subtle">
              The service and city cannot be changed after creation — the URL depends on them.
            </p>
          </>
        ) : null}
      </fieldset>

      <fieldset className="space-y-5 border-t border-line pt-6">
        <legend className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Local content
        </legend>

        <Field
          id="localIntro"
          label="Local introduction"
          hint="At least 120 words, and genuinely about this city — not another city's intro with the name swapped."
        >
          {(aria) => (
            <Textarea {...aria} name="localIntro" rows={8} defaultValue={page?.localIntro ?? ""} />
          )}
        </Field>

        <Field
          id="marketContext"
          label="Market context"
          hint="At least 100 words on what is different about this market."
        >
          {(aria) => (
            <Textarea {...aria} name="marketContext" rows={6} defaultValue={page?.marketContext ?? ""} />
          )}
        </Field>

        <Field
          id="industries"
          label="Local industries"
          hint="One per line, or comma separated. At least three."
        >
          {(aria) => (
            <Textarea
              {...aria}
              name="industries"
              rows={4}
              defaultValue={page?.industries.join("\n") ?? ""}
            />
          )}
        </Field>

        <Field id="positioning" label="Positioning statement">
          {(aria) => (
            <Textarea {...aria} name="positioning" rows={3} defaultValue={page?.positioning ?? ""} />
          )}
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="ctaHeading" label="CTA heading">
            {(aria) => <Input {...aria} name="ctaHeading" defaultValue={page?.ctaHeading ?? ""} />}
          </Field>
          <Field id="ctaBody" label="CTA body">
            {(aria) => <Input {...aria} name="ctaBody" defaultValue={page?.ctaBody ?? ""} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-5 border-t border-line pt-6">
        <legend className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Metadata
        </legend>
        <Field id="metaTitle" label="Meta title">
          {(aria) => <Input {...aria} name="metaTitle" defaultValue={page?.metaTitle ?? ""} />}
        </Field>
        <Field
          id="metaDescription"
          label="Meta description"
          hint="At least 70 characters, and different from every other city page for this service."
        >
          {(aria) => (
            <Textarea {...aria} name="metaDescription" rows={3} defaultValue={page?.metaDescription ?? ""} />
          )}
        </Field>
        <Field
          id="canonical"
          label="Canonical override"
          hint="Leave blank to derive it from the page URL, which is almost always correct."
        >
          {(aria) => <Input {...aria} name="canonical" defaultValue={page?.canonical ?? ""} />}
        </Field>
      </fieldset>

      <div className="flex gap-2 border-t border-line pt-5">
        <Submit label={page ? "Save changes" : "Create page"} />
      </div>
    </form>
  );
}
