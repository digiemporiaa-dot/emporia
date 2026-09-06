"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { saveCityAction, type CityActionState } from "../actions";

type City = {
  id: string;
  name: string;
  slug: string;
  state: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  population: number | null;
  isActive: boolean;
  order: number;
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function CityForm({ city }: { city?: City }) {
  const [state, formAction] = useActionState<CityActionState, FormData>(saveCityAction, null);
  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;

  const err = (name: string) => fieldErrors?.[name]?.[0];

  return (
    <form action={formAction} className="max-w-2xl space-y-5" noValidate>
      {city ? <input type="hidden" name="id" value={city.id} /> : null}

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

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="City name" required error={err("name")}>
          {(aria) => <Input {...aria} name="name" defaultValue={city?.name} required />}
        </Field>
        <Field id="slug" label="Slug" required hint="Used in the URL: /cities/<slug>" error={err("slug")}>
          {(aria) => <Input {...aria} name="slug" defaultValue={city?.slug} required />}
        </Field>
        <Field id="state" label="State" required error={err("state")}>
          {(aria) => <Input {...aria} name="state" defaultValue={city?.state} required />}
        </Field>
        <Field id="country" label="Country" error={err("country")}>
          {(aria) => <Input {...aria} name="country" defaultValue={city?.country ?? "India"} />}
        </Field>
        <Field
          id="latitude"
          label="Latitude"
          hint="Required for LocalBusiness schema"
          error={err("latitude")}
        >
          {(aria) => (
            <Input {...aria} name="latitude" type="number" step="any" defaultValue={city?.latitude ?? ""} />
          )}
        </Field>
        <Field id="longitude" label="Longitude" error={err("longitude")}>
          {(aria) => (
            <Input {...aria} name="longitude" type="number" step="any" defaultValue={city?.longitude ?? ""} />
          )}
        </Field>
        <Field id="population" label="Population" error={err("population")}>
          {(aria) => (
            <Input {...aria} name="population" type="number" defaultValue={city?.population ?? ""} />
          )}
        </Field>
        <Field id="order" label="Sort order" error={err("order")}>
          {(aria) => <Input {...aria} name="order" type="number" defaultValue={city?.order ?? 0} />}
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-navy-800">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={city?.isActive ?? true}
          className="size-4 accent-[var(--color-brand-red)]"
        />
        Active — inactive cities and their local pages are hidden from the public site
      </label>

      <div className="flex gap-2 border-t border-line pt-5">
        <Submit label={city ? "Save changes" : "Create city"} />
        <Link href="/admin/catalog/cities">
          <Button variant="secondary" type="button">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
