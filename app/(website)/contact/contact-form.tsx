"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { submitContactAction, type ContactState } from "./actions";

const INITIAL_CONTACT_STATE: ContactState = {
  status: "idle",
  message: null,
  fieldErrors: {},
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-12 items-center justify-center rounded-md bg-brand-red px-6 text-base font-medium text-white transition-colors duration-(--duration-fast) hover:bg-red-600 disabled:opacity-60"
    >
      {pending ? "Sending…" : "Send enquiry"}
    </button>
  );
}

export function ContactForm({ services }: { services: readonly { id: string; name: string }[] }) {
  const [state, formAction] = useActionState(submitContactAction, INITIAL_CONTACT_STATE);

  if (state.status === "success") {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-md border border-success/30 bg-success-bg px-5 py-6"
      >
        <CheckCircle2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-success" />
        <div>
          <p className="font-display text-lg text-navy-800">Enquiry received</p>
          <p className="mt-1.5 text-sm text-ink-muted">{state.message}</p>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.status === "error" && state.message ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
        >
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Name" required error={state.fieldErrors["name"]}>
          {(aria) => <Input {...aria} name="name" autoComplete="name" required />}
        </Field>

        <Field id="email" label="Email" required error={state.fieldErrors["email"]}>
          {(aria) => <Input {...aria} name="email" type="email" autoComplete="email" required />}
        </Field>

        <Field id="phone" label="Phone" error={state.fieldErrors["phone"]}>
          {(aria) => <Input {...aria} name="phone" type="tel" autoComplete="tel" />}
        </Field>

        <Field id="company" label="Company" error={state.fieldErrors["company"]}>
          {(aria) => <Input {...aria} name="company" autoComplete="organization" />}
        </Field>
      </div>

      <Field
        id="serviceId"
        label="What are you interested in?"
        error={state.fieldErrors["serviceId"]}
      >
        {(aria) => (
          <Select {...aria} name="serviceId" defaultValue="">
            <option value="">Not sure yet</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        id="message"
        label="What are you trying to move?"
        required
        hint="The more specific, the more useful our first reply will be."
        error={state.fieldErrors["message"]}
      >
        {(aria) => <Textarea {...aria} name="message" rows={6} required />}
      </Field>

      {/* Honeypot. Hidden from users and from assistive technology; bots fill it. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <SubmitButton />

      <p className="text-xs text-ink-subtle">
        We use your details only to reply to this enquiry. See our privacy policy.
      </p>
    </form>
  );
}
