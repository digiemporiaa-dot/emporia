"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { trackMetaLead } from "@/components/website/tracking/loaders";

/**
 * Popup host.
 *
 * Asks the server what to show for the current path and renders at most that.
 * All targeting, scheduling and frequency decisions were already made server
 * side — this component only handles the trigger and the dialog.
 *
 * Accessibility (CLAUDE.md 10): focus moves into the dialog and is trapped,
 * Esc closes, focus returns to where it was, `role="dialog"` with
 * `aria-modal`, and a labelled close control.
 */

type Popup = {
  id: string;
  title: string;
  body: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  trigger: "PAGE_LOAD" | "TIME_DELAY" | "SCROLL_PERCENT" | "EXIT_INTENT" | "BUTTON_CLICK";
  triggerValue: number | null;
};

type Status = "idle" | "submitting" | "done" | "error";

async function postEvent(popupId: string, event: "VIEW" | "FORM_START", path: string) {
  try {
    await fetch("/api/popups/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ popupId, event, path }),
      keepalive: true,
    });
  } catch {
    // Analytics must never interrupt the visitor.
  }
}

export function PopupHost() {
  const pathname = usePathname();
  const [popup, setPopup] = React.useState<Popup | null>(null);
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState<Status>("idle");
  const [error, setError] = React.useState<string | null>(null);

  const panelRef = React.useRef<HTMLDivElement>(null);
  const restoreFocusTo = React.useRef<HTMLElement | null>(null);
  const startedRef = React.useRef(false);

  // Ask the server what, if anything, to show here.
  React.useEffect(() => {
    let cancelled = false;
    setPopup(null);
    setOpen(false);
    setStatus("idle");
    startedRef.current = false;

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/popups/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: pathname }),
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as { popup: Popup | null };
        if (!cancelled && data.popup) setPopup(data.popup);
      } catch {
        // A popup failing to load is not worth surfacing to the visitor.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pathname]);

  // Trigger handling.
  React.useEffect(() => {
    if (!popup || open) return;

    const show = () => setOpen(true);

    switch (popup.trigger) {
      case "PAGE_LOAD": {
        show();
        return;
      }
      case "TIME_DELAY": {
        const timer = setTimeout(show, (popup.triggerValue ?? 5) * 1000);
        return () => clearTimeout(timer);
      }
      case "SCROLL_PERCENT": {
        const threshold = (popup.triggerValue ?? 50) / 100;
        const onScroll = () => {
          const scrollable = document.documentElement.scrollHeight - window.innerHeight;
          if (scrollable <= 0) return;
          if (window.scrollY / scrollable >= threshold) show();
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
      }
      case "EXIT_INTENT": {
        const onLeave = (event: MouseEvent) => {
          if (event.clientY <= 0) show();
        };
        document.addEventListener("mouseout", onLeave);
        return () => document.removeEventListener("mouseout", onLeave);
      }
      case "BUTTON_CLICK": {
        const onClick = (event: Event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest("[data-popup-trigger]")) show();
        };
        document.addEventListener("click", onClick);
        return () => document.removeEventListener("click", onClick);
      }
      default:
        return;
    }
  }, [popup, open]);

  const close = React.useCallback(() => {
    setOpen(false);
    restoreFocusTo.current?.focus();
  }, []);

  // Focus management and the escape key.
  React.useEffect(() => {
    if (!open || !popup) return;

    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    void postEvent(popup.id, "VIEW", pathname);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("input, button, a")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), textarea, select",
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, popup, pathname, close]);

  const onFirstInput = () => {
    if (startedRef.current || !popup) return;
    startedRef.current = true;
    void postEvent(popup.id, "FORM_START", pathname);
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!popup) return;

    setStatus("submitting");
    setError(null);

    const form = new FormData(event.currentTarget);
    // One id, generated here and used by both copies of this conversion: the
    // pixel fires with it below, the server sends it to the Conversions API.
    // Generating one per copy would double every lead instead of deduplicating
    // it (lib/tracking/capi.ts).
    const eventId = crypto.randomUUID();
    const payload = {
      eventId,
      popupId: popup.id,
      path: pathname,
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
      company: "",
      message: String(form.get("message") ?? ""),
      website: String(form.get("website") ?? ""),
    };

    try {
      const response = await fetch("/api/leads/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { ok: boolean; message?: string };

      if (data.ok) {
        setStatus("done");
        // Silent when no pixel is loaded, which is the case whenever marketing
        // consent was refused.
        trackMetaLead(eventId);
      } else {
        setStatus("error");
        setError(data.message ?? "Please check the details and try again.");
      }
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  }

  if (!popup || !open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy-900/40 p-4 sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="popup-title"
        className="w-full max-w-md rounded-lg border border-line bg-white shadow-lg"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <h2 id="popup-title" className="font-display text-lg text-navy-800">
            {popup.title}
          </h2>
          <button
            type="button"
            onClick={close}
            className="rounded-sm p-1 text-ink-subtle transition-colors hover:bg-surface-muted hover:text-navy-800"
          >
            <X size={16} aria-hidden="true" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        {status === "done" ? (
          <div className="px-5 py-8 text-center" role="status">
            <p className="font-display text-lg text-navy-800">Thank you</p>
            <p className="mt-1.5 text-sm text-ink-muted">
              We have your details and will be in touch shortly.
            </p>
            <button
              type="button"
              onClick={close}
              className="mt-5 inline-flex h-9 items-center rounded-md border border-line-strong px-4 text-sm text-navy-800"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3.5 px-5 py-4" noValidate>
            {popup.body ? <p className="text-sm text-ink-muted">{popup.body}</p> : null}

            {error ? (
              <p role="alert" className="text-xs text-brand-red-text">
                {error}
              </p>
            ) : null}

            <div className="space-y-1">
              <label htmlFor="popup-name" className="block text-xs font-medium text-ink-muted">
                Name
              </label>
              <input
                id="popup-name"
                name="name"
                required
                onInput={onFirstInput}
                className="h-9.5 w-full rounded-md border border-line-strong px-3 text-sm focus:border-brand-red focus:outline-none focus:ring-3 focus:ring-brand-red/25"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="popup-email" className="block text-xs font-medium text-ink-muted">
                Email
              </label>
              <input
                id="popup-email"
                name="email"
                type="email"
                required
                onInput={onFirstInput}
                className="h-9.5 w-full rounded-md border border-line-strong px-3 text-sm focus:border-brand-red focus:outline-none focus:ring-3 focus:ring-brand-red/25"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="popup-phone" className="block text-xs font-medium text-ink-muted">
                Phone <span className="text-ink-subtle">(optional)</span>
              </label>
              <input
                id="popup-phone"
                name="phone"
                type="tel"
                onInput={onFirstInput}
                className="h-9.5 w-full rounded-md border border-line-strong px-3 text-sm focus:border-brand-red focus:outline-none focus:ring-3 focus:ring-brand-red/25"
              />
            </div>

            {/* Honeypot. Hidden from users and assistive technology. */}
            <div className="hidden" aria-hidden="true">
              <label htmlFor="popup-website">Website</label>
              <input id="popup-website" name="website" tabIndex={-1} autoComplete="off" />
            </div>

            <button
              type="submit"
              disabled={status === "submitting"}
              className="h-10 w-full rounded-md bg-brand-red text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-60"
            >
              {status === "submitting" ? "Sending…" : (popup.ctaLabel ?? "Send")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
