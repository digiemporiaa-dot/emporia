"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { trackMetaLead } from "@/components/website/tracking/loaders";
import { cn } from "@/lib/utils/cn";
import { useHydrated } from "@/lib/utils/hydrated";
import type { LeadFormVariant } from "@/lib/content/blocks";

/**
 * The form a `leadForm` block renders.
 *
 * It sends the submitter's details and the id of the section it belongs to;
 * everything else — which service the lead is for, what to say back, the
 * campaign and referrer it arrived on — is decided server-side from the stored
 * block and from httpOnly cookies. See lib/services/lead.service.ts.
 *
 * The client component is this form alone, not the band around it: the heading,
 * copy and background are server-rendered by the block (CLAUDE.md 2 rule 8).
 */

const FIELDS: Record<LeadFormVariant, readonly ("name" | "phone" | "company" | "message")[]> = {
  lead: ["name", "phone", "company", "message"],
  contact: ["name", "phone", "message"],
  newsletter: [],
};

const LABELS = {
  name: "Your name",
  phone: "Phone",
  company: "Company",
  message: "What are you trying to move?",
} as const;

const input =
  "w-full rounded-md border border-line-strong bg-white px-3 py-2.5 text-sm text-ink " +
  "placeholder:text-ink-subtle focus:border-brand-red focus:outline-none focus:ring-3 focus:ring-brand-red/25";

export function LeadForm({
  sectionId,
  variant,
  submitLabel,
  successMessage,
  consentText,
  compact = false,
}: {
  sectionId: string;
  variant: LeadFormVariant;
  submitLabel: string;
  successMessage: string;
  consentText?: string | undefined;
  compact?: boolean;
}) {
  const pathname = usePathname();
  /**
   * Sending waits for hydration.
   *
   * This form submits through `fetch`, so before React is alive the button does
   * a native post: the page reloads, the fields empty, and nothing is captured.
   * Rendered disabled and enabled on hydration, which is a moment on any real
   * connection and honest on none.
   */
  const ready = useHydrated();
  const [status, setStatus] = React.useState<"idle" | "submitting" | "done" | "error">("idle");
  const [message, setMessage] = React.useState<string | null>(null);
  const fields = FIELDS[variant];

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setMessage(null);

    const form = new FormData(event.currentTarget);
    // One id, used by both copies of this conversion: the pixel fires with it
    // below and the server sends the same one to the Conversions API, so Meta
    // deduplicates rather than counting the lead twice.
    const eventId = crypto.randomUUID();

    try {
      const response = await fetch("/api/leads/page-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          sectionId,
          path: pathname,
          name: String(form.get("name") ?? ""),
          email: String(form.get("email") ?? ""),
          phone: String(form.get("phone") ?? ""),
          company: String(form.get("company") ?? ""),
          message: String(form.get("message") ?? ""),
          website: String(form.get("website") ?? ""),
        }),
      });
      const data = (await response.json()) as { ok: boolean; message?: string };

      if (data.ok) {
        setStatus("done");
        setMessage(data.message ?? successMessage);
        // Silent when no pixel is loaded, which is the case whenever marketing
        // consent was refused.
        trackMetaLead(eventId);
        return;
      }
      setStatus("error");
      setMessage(data.message ?? "Please check the details and try again.");
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  if (status === "done") {
    return (
      <p
        role="status"
        className="flex items-start gap-2 rounded-md border border-success/30 bg-success-bg px-4 py-3.5 text-sm text-success"
      >
        <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
        {message ?? successMessage}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      {status === "error" && message ? (
        <p
          role="alert"
          className="rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
        >
          {message}
        </p>
      ) : null}

      <div className={cn("grid gap-3", !compact && fields.length > 2 && "sm:grid-cols-2")}>
        {fields.includes("name") ? (
          <label className="block">
            <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-muted">
              {LABELS.name}
            </span>
            <input name="name" type="text" required autoComplete="name" className={input} />
          </label>
        ) : null}

        <label className="block">
          <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-muted">
            Email
          </span>
          <input name="email" type="email" required autoComplete="email" className={input} />
        </label>

        {fields.includes("phone") ? (
          <label className="block">
            <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-muted">
              {LABELS.phone}
            </span>
            <input name="phone" type="tel" autoComplete="tel" className={input} />
          </label>
        ) : null}

        {fields.includes("company") ? (
          <label className="block">
            <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-muted">
              {LABELS.company}
            </span>
            <input name="company" type="text" autoComplete="organization" className={input} />
          </label>
        ) : null}
      </div>

      {fields.includes("message") ? (
        <label className="block">
          <span className="mb-1 block text-2xs font-medium uppercase tracking-wide text-ink-muted">
            {LABELS.message}
          </span>
          <textarea name="message" rows={4} className={cn(input, "min-h-24")} />
        </label>
      ) : null}

      {/* Honeypot. Hidden from sight and from screen readers, and never focusable. */}
      <div className="hidden" aria-hidden="true">
        <label>
          Leave this empty
          <input name="website" type="text" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={status === "submitting" || !ready}
          className="inline-flex h-11 items-center rounded-md bg-brand-red px-5 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-60"
        >
          {status === "submitting" ? "Sending…" : submitLabel}
        </button>
        {consentText ? <p className="text-xs text-ink-subtle">{consentText}</p> : null}
      </div>
    </form>
  );
}
