"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { savePackageAction, type PackageActionState } from "../actions";

type Feature = { label: string; detail: string; isIncluded: boolean };

type PackageValues = {
  id: string;
  name: string;
  slug: string;
  tagline: string | null;
  serviceId: string | null;
  price: string;
  currency: string;
  taxRate: string;
  billingType: string;
  isRecommended: boolean;
  status: string;
  order: number;
  features: Feature[];
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function PackageForm({
  services,
  pkg,
}: {
  services: readonly { id: string; name: string }[];
  pkg?: PackageValues;
}) {
  const [state, formAction] = useActionState<PackageActionState, FormData>(savePackageAction, null);
  const [features, setFeatures] = React.useState<Feature[]>(
    pkg?.features ?? [{ label: "", detail: "", isIncluded: true }],
  );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {pkg ? <input type="hidden" name="id" value={pkg.id} /> : null}
      {/* Features travel as JSON so their order and flags survive intact. */}
      <input type="hidden" name="features" value={JSON.stringify(features)} />

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
          Saved.
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Name" required>
          {(aria) => <Input {...aria} name="name" defaultValue={pkg?.name} required />}
        </Field>
        <Field id="slug" label="Slug" required hint="/packages/<slug>">
          {(aria) => <Input {...aria} name="slug" defaultValue={pkg?.slug} required />}
        </Field>
      </div>

      <Field id="tagline" label="Tagline">
        {(aria) => <Input {...aria} name="tagline" defaultValue={pkg?.tagline ?? ""} />}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="price" label="Price" required hint="Digits only, e.g. 125000">
          {(aria) => <Input {...aria} name="price" inputMode="decimal" defaultValue={pkg?.price} required />}
        </Field>
        <Field id="currency" label="Currency">
          {(aria) => (
            <Select {...aria} name="currency" defaultValue={pkg?.currency ?? "INR"}>
              {["INR", "USD", "EUR", "GBP", "AED"].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="taxRate" label="Tax rate %" hint="e.g. 18">
          {(aria) => <Input {...aria} name="taxRate" inputMode="decimal" defaultValue={pkg?.taxRate ?? "0"} />}
        </Field>
        <Field id="billingType" label="Billing">
          {(aria) => (
            <Select {...aria} name="billingType" defaultValue={pkg?.billingType ?? "MONTHLY"}>
              {["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL", "RETAINER"].map((b) => (
                <option key={b} value={b}>
                  {b.toLowerCase().replace("_", " ")}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field id="serviceId" label="Service">
          {(aria) => (
            <Select {...aria} name="serviceId" defaultValue={pkg?.serviceId ?? ""}>
              <option value="">Not service-specific</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="status" label="Status">
          {(aria) => (
            <Select {...aria} name="status" defaultValue={pkg?.status ?? "DRAFT"}>
              {["DRAFT", "PUBLISHED", "ARCHIVED"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="order" label="Sort order">
          {(aria) => <Input {...aria} name="order" type="number" defaultValue={pkg?.order ?? 0} />}
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-navy-800">
        <input
          type="checkbox"
          name="isRecommended"
          defaultChecked={pkg?.isRecommended ?? false}
          className="size-4 accent-[var(--color-brand-red)]"
        />
        Mark as the recommended package
      </label>

      <fieldset className="space-y-3 border-t border-line pt-6">
        <legend className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Features
        </legend>
        <p className="text-xs text-ink-subtle">
          These drive the comparison table. A feature marked not included still appears, shown as
          excluded, so the columns line up.
        </p>

        <ul className="space-y-2">
          {features.map((feature, index) => (
            <li key={index} className="flex items-start gap-2">
              <input
                aria-label={`Feature ${index + 1} label`}
                value={feature.label}
                onChange={(e) =>
                  setFeatures((f) => f.map((x, i) => (i === index ? { ...x, label: e.target.value } : x)))
                }
                placeholder="Feature"
                className="h-9 flex-1 rounded-md border border-line-strong px-3 text-sm focus:border-brand-red"
              />
              <input
                aria-label={`Feature ${index + 1} detail`}
                value={feature.detail}
                onChange={(e) =>
                  setFeatures((f) => f.map((x, i) => (i === index ? { ...x, detail: e.target.value } : x)))
                }
                placeholder="Detail (optional)"
                className="h-9 flex-1 rounded-md border border-line-strong px-3 text-sm focus:border-brand-red"
              />
              <label className="flex h-9 items-center gap-1.5 whitespace-nowrap text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={feature.isIncluded}
                  onChange={(e) =>
                    setFeatures((f) =>
                      f.map((x, i) => (i === index ? { ...x, isIncluded: e.target.checked } : x)),
                    )
                  }
                  className="size-4 accent-[var(--color-brand-red)]"
                />
                Included
              </label>
              <button
                type="button"
                onClick={() => setFeatures((f) => f.filter((_, i) => i !== index))}
                className="mt-1 rounded-sm p-1 text-ink-subtle hover:bg-red-50 hover:text-brand-red"
              >
                <Trash2 size={14} aria-hidden="true" />
                <span className="sr-only">Remove feature {index + 1}</span>
              </button>
            </li>
          ))}
        </ul>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setFeatures((f) => [...f, { label: "", detail: "", isIncluded: true }])}
        >
          <Plus size={14} aria-hidden="true" /> Add feature
        </Button>
      </fieldset>

      <div className="border-t border-line pt-5">
        <Submit label={pkg ? "Save changes" : "Create package"} />
      </div>
    </form>
  );
}
