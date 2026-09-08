"use client";

import * as React from "react";
import { Cookie, X } from "lucide-react";
import type { ConsentMode } from "@/lib/validation/tracking";
import type { ResolvedConsent } from "@/lib/tracking/consent";

/**
 * The consent banner and preferences dialog.
 *
 * Accessibility (CLAUDE.md 12): the banner is a labelled `region` rather than
 * a dialog, because it does not trap focus or block the page — a visitor may
 * ignore it and read on, which is the correct behaviour under implied and
 * opt-out. The preferences panel *is* a dialog and uses the platform one, so
 * focus trapping, Esc and focus restoration come from the browser.
 *
 * A visitor who has already decided still gets the small "Cookie settings"
 * button, because a consent decision they cannot revisit is not a decision.
 */

const DEFAULT_TEXT =
  "We use cookies to understand how the site is used and to measure our marketing. You can choose what to allow.";

const DEFAULT_TEXT_IMPLIED =
  "We use cookies to understand how the site is used and to measure our marketing. By continuing you agree to this; you can change your choice at any time.";

export function ConsentBanner({
  mode,
  bannerText,
  consent,
  openPreferences,
  onOpenPreferences,
  onClosePreferences,
  onAcceptAll,
  onRejectAll,
  onSave,
}: {
  mode: ConsentMode;
  bannerText: string | null;
  consent: ResolvedConsent;
  openPreferences: boolean;
  onOpenPreferences: () => void;
  onClosePreferences: () => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onSave: (analytics: boolean, marketing: boolean) => void;
}) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [analytics, setAnalytics] = React.useState(consent.analytics);
  const [marketing, setMarketing] = React.useState(consent.marketing);

  React.useEffect(() => {
    setAnalytics(consent.analytics);
    setMarketing(consent.marketing);
  }, [consent.analytics, consent.marketing]);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (openPreferences && !dialog.open) dialog.showModal();
    if (!openPreferences && dialog.open) dialog.close();
  }, [openPreferences]);

  const text = bannerText ?? (mode === "IMPLIED" ? DEFAULT_TEXT_IMPLIED : DEFAULT_TEXT);

  return (
    <>
      {consent.needsDecision ? (
        <section
          aria-label="Cookie choices"
          className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white/95 backdrop-blur"
        >
          <div className="mx-auto flex max-w-(--container-page) flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:gap-6 lg:px-8">
            <p className="flex-1 text-sm text-ink-muted">{text}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onOpenPreferences}
                className="rounded-md px-3 py-2 text-sm text-ink-muted underline underline-offset-4 hover:text-navy-800"
              >
                Manage preferences
              </button>
              {/*
                Reject is a real button of the same weight as accept. A
                "reject" hidden behind a link while "accept" is a filled button
                is a dark pattern, and under opt-in it is not consent at all.
              */}
              <button
                type="button"
                onClick={onRejectAll}
                className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-navy-800 hover:bg-surface-muted"
              >
                {mode === "IMPLIED" ? "Only essential" : "Reject non-essential"}
              </button>
              <button
                type="button"
                onClick={onAcceptAll}
                className="rounded-md bg-brand-red px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
              >
                Accept all
              </button>
            </div>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={onOpenPreferences}
          className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-1.5 rounded-full border border-line bg-white/90 px-3 py-1.5 text-xs text-ink-muted shadow-sm backdrop-blur hover:text-navy-800"
        >
          <Cookie size={13} aria-hidden="true" />
          Cookie settings
        </button>
      )}

      <dialog
        ref={dialogRef}
        onClose={onClosePreferences}
        aria-labelledby="consent-title"
        className="w-[min(30rem,calc(100vw-2rem))] rounded-lg border border-line bg-white p-0 backdrop:bg-navy-800/40"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <h2 id="consent-title" className="font-display text-lg text-navy-800">
            Cookie preferences
          </h2>
          <button
            type="button"
            onClick={onClosePreferences}
            aria-label="Close cookie preferences"
            className="rounded-sm p-1 text-ink-subtle hover:text-navy-800"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <Category
            title="Necessary"
            description="Signing in, security and remembering this choice. These cannot be turned off."
            checked
            disabled
          />
          <Category
            title="Analytics"
            description="How the site is used, so we can improve it. Google Analytics, Microsoft Clarity, Hotjar."
            checked={analytics}
            onChange={setAnalytics}
          />
          <Category
            title="Marketing"
            description="Measuring our advertising. Google Ads, Meta, Pinterest, TikTok, Snapchat."
            checked={marketing}
            onChange={setMarketing}
          />
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={onRejectAll}
            className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-navy-800 hover:bg-surface-muted"
          >
            Reject non-essential
          </button>
          <button
            type="button"
            onClick={() => onSave(analytics, marketing)}
            className="rounded-md bg-brand-red px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
          >
            Save preferences
          </button>
        </div>
      </dialog>
    </>
  );
}

function Category({
  title,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
        className="mt-1 size-4 rounded-xs border-line-strong text-brand-red disabled:opacity-60"
      />
      <label htmlFor={id} className="flex-1">
        <span className="block text-sm font-medium text-navy-800">
          {title}
          {disabled ? <span className="ml-2 text-2xs text-ink-subtle">Always on</span> : null}
        </span>
        <span className="mt-0.5 block text-xs text-ink-muted">{description}</span>
      </label>
    </div>
  );
}
