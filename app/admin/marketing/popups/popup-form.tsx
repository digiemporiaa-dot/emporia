"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { savePopupAction, type PopupActionState } from "../actions";

type Target = {
  type: "GLOBAL" | "PAGE" | "SERVICE" | "CITY" | "SERVICE_CITY" | "PACKAGE";
  path: string;
  serviceId: string;
  cityId: string;
  packageId: string;
  visitorType: "NEW" | "RETURNING" | "ANY";
  device: "DESKTOP" | "TABLET" | "MOBILE" | "ANY";
};

export type PopupValues = {
  id: string;
  name: string;
  title: string;
  body: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  trigger: string;
  triggerValue: number | null;
  frequency: string;
  priority: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  targets: Target[];
};

type Option = { id: string; name: string };

const EMPTY_TARGET: Target = {
  type: "PAGE",
  path: "",
  serviceId: "",
  cityId: "",
  packageId: "",
  visitorType: "ANY",
  device: "ANY",
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function PopupForm({
  services,
  cities,
  packages,
  popup,
}: {
  services: readonly Option[];
  cities: readonly Option[];
  packages: readonly Option[];
  popup?: PopupValues;
}) {
  const [state, formAction] = useActionState<PopupActionState, FormData>(savePopupAction, null);
  const [targets, setTargets] = React.useState<Target[]>(popup?.targets ?? [EMPTY_TARGET]);
  const [trigger, setTrigger] = React.useState(popup?.trigger ?? "TIME_DELAY");

  const update = (index: number, patch: Partial<Target>) =>
    setTargets((t) => t.map((x, i) => (i === index ? { ...x, ...patch } : x)));

  const triggerHint =
    trigger === "TIME_DELAY"
      ? "Seconds to wait before showing."
      : trigger === "SCROLL_PERCENT"
        ? "Percent of the page scrolled, 1 to 100."
        : trigger === "BUTTON_CLICK"
          ? "Fires when an element with data-popup-trigger is clicked."
          : "No value needed for this trigger.";

  const needsValue = trigger === "TIME_DELAY" || trigger === "SCROLL_PERCENT";

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {popup ? <input type="hidden" name="id" value={popup.id} /> : null}
      <input type="hidden" name="targets" value={JSON.stringify(targets)} />

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

      <fieldset className="space-y-5">
        <legend className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Content
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="name" label="Internal name" required hint="Only staff see this.">
            {(aria) => <Input {...aria} name="name" defaultValue={popup?.name} required />}
          </Field>
          <Field id="title" label="Heading" required hint="Visitors see this.">
            {(aria) => <Input {...aria} name="title" defaultValue={popup?.title} required />}
          </Field>
        </div>
        <Field id="body" label="Body">
          {(aria) => <Textarea {...aria} name="body" rows={3} defaultValue={popup?.body ?? ""} />}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="ctaLabel" label="Submit button label">
            {(aria) => <Input {...aria} name="ctaLabel" defaultValue={popup?.ctaLabel ?? ""} />}
          </Field>
          <Field id="ctaHref" label="CTA link (optional)">
            {(aria) => <Input {...aria} name="ctaHref" defaultValue={popup?.ctaHref ?? ""} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-5 border-t border-line pt-6">
        <legend className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Behaviour
        </legend>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="trigger" label="Trigger">
            {(aria) => (
              <Select
                {...aria}
                name="trigger"
                defaultValue={popup?.trigger ?? "TIME_DELAY"}
                onChange={(e) => setTrigger(e.target.value)}
              >
                {["PAGE_LOAD", "TIME_DELAY", "SCROLL_PERCENT", "EXIT_INTENT", "BUTTON_CLICK"].map((t) => (
                  <option key={t} value={t}>
                    {t.toLowerCase().replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="triggerValue" label="Trigger value" hint={triggerHint}>
            {(aria) => (
              <Input
                {...aria}
                name="triggerValue"
                type="number"
                disabled={!needsValue}
                defaultValue={popup?.triggerValue ?? ""}
              />
            )}
          </Field>
          <Field id="frequency" label="Frequency">
            {(aria) => (
              <Select {...aria} name="frequency" defaultValue={popup?.frequency ?? "ONCE_PER_SESSION"}>
                {[
                  "EVERY_VISIT",
                  "ONCE_PER_SESSION",
                  "ONCE_PER_DAY",
                  "ONCE_PER_WEEK",
                  "ONCE_PER_USER",
                ].map((f) => (
                  <option key={f} value={f}>
                    {f.toLowerCase().replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="priority" label="Priority" hint="Higher wins when two match.">
            {(aria) => <Input {...aria} name="priority" type="number" defaultValue={popup?.priority ?? 0} />}
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="startsAt" label="Starts at" hint="Leave blank to start immediately.">
            {(aria) => (
              <Input {...aria} name="startsAt" type="datetime-local" defaultValue={popup?.startsAt ?? ""} />
            )}
          </Field>
          <Field id="endsAt" label="Ends at" hint="Leave blank to run indefinitely.">
            {(aria) => (
              <Input {...aria} name="endsAt" type="datetime-local" defaultValue={popup?.endsAt ?? ""} />
            )}
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-navy-800">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={popup?.isActive ?? false}
            className="size-4 accent-[var(--color-brand-red)]"
          />
          Active — an active popup needs at least one targeting rule
        </label>
      </fieldset>

      <fieldset className="space-y-3 border-t border-line pt-6">
        <legend className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Targeting
        </legend>
        <p className="text-xs text-ink-subtle">
          A popup fires where any rule matches. Resolution happens on the server, so a visitor never
          receives a popup they are not targeted for. Paths accept a trailing wildcard, e.g.{" "}
          <code className="font-mono">/services/*</code>.
        </p>

        <ul className="space-y-3">
          {targets.map((target, index) => (
            <li key={index} className="rounded-md border border-line bg-surface-muted p-3">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                    Rule {index + 1} type
                  </span>
                  <select
                    value={target.type}
                    onChange={(e) => update(index, { type: e.target.value as Target["type"] })}
                    className="h-9 w-full rounded-md border border-line-strong bg-white px-2 text-sm"
                  >
                    {["GLOBAL", "PAGE", "SERVICE", "CITY", "SERVICE_CITY", "PACKAGE"].map((t) => (
                      <option key={t} value={t}>
                        {t.toLowerCase().replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>

                {target.type === "PAGE" ? (
                  <label className="block lg:col-span-2">
                    <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                      Path
                    </span>
                    <input
                      value={target.path}
                      onChange={(e) => update(index, { path: e.target.value })}
                      placeholder="/services/seo/gurgaon"
                      className="h-9 w-full rounded-md border border-line-strong bg-white px-2 text-sm"
                    />
                  </label>
                ) : null}

                {target.type === "SERVICE" || target.type === "SERVICE_CITY" ? (
                  <label className="block">
                    <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                      Service
                    </span>
                    <select
                      value={target.serviceId}
                      onChange={(e) => update(index, { serviceId: e.target.value })}
                      className="h-9 w-full rounded-md border border-line-strong bg-white px-2 text-sm"
                    >
                      <option value="">Choose…</option>
                      {services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {target.type === "CITY" || target.type === "SERVICE_CITY" ? (
                  <label className="block">
                    <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                      City
                    </span>
                    <select
                      value={target.cityId}
                      onChange={(e) => update(index, { cityId: e.target.value })}
                      className="h-9 w-full rounded-md border border-line-strong bg-white px-2 text-sm"
                    >
                      <option value="">Choose…</option>
                      {cities.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {target.type === "PACKAGE" ? (
                  <label className="block">
                    <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                      Package
                    </span>
                    <select
                      value={target.packageId}
                      onChange={(e) => update(index, { packageId: e.target.value })}
                      className="h-9 w-full rounded-md border border-line-strong bg-white px-2 text-sm"
                    >
                      <option value="">Choose…</option>
                      {packages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label className="block">
                  <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                    Visitor
                  </span>
                  <select
                    value={target.visitorType}
                    onChange={(e) => update(index, { visitorType: e.target.value as Target["visitorType"] })}
                    className="h-9 w-full rounded-md border border-line-strong bg-white px-2 text-sm"
                  >
                    <option value="ANY">Any</option>
                    <option value="NEW">New only</option>
                    <option value="RETURNING">Returning only</option>
                  </select>
                </label>

                <label className="block">
                  <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                    Device
                  </span>
                  <select
                    value={target.device}
                    onChange={(e) => update(index, { device: e.target.value as Target["device"] })}
                    className="h-9 w-full rounded-md border border-line-strong bg-white px-2 text-sm"
                  >
                    <option value="ANY">Any</option>
                    <option value="DESKTOP">Desktop</option>
                    <option value="TABLET">Tablet</option>
                    <option value="MOBILE">Mobile</option>
                  </select>
                </label>
              </div>

              <button
                type="button"
                onClick={() => setTargets((t) => t.filter((_, i) => i !== index))}
                className="mt-2 inline-flex items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs text-ink-subtle hover:bg-red-50 hover:text-brand-red-text"
              >
                <Trash2 size={13} aria-hidden="true" /> Remove rule {index + 1}
              </button>
            </li>
          ))}
        </ul>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setTargets((t) => [...t, EMPTY_TARGET])}
        >
          <Plus size={14} aria-hidden="true" /> Add rule
        </Button>
      </fieldset>

      <div className="border-t border-line pt-5">
        <Submit label={popup ? "Save changes" : "Create popup"} />
      </div>
    </form>
  );
}
