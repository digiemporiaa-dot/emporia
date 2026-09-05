"use client";

import * as React from "react";
import { AlertCircle, Sparkles } from "lucide-react";

/**
 * The frame every AI suggestion appears in.
 *
 * One component, so the label cannot be forgotten on a new assist: what the
 * reader sees is always marked as generated, always names the model, and always
 * says plainly that it is a draft they have to edit and save
 * (CLAUDE.md 16).
 */
export function AIDraft({
  model,
  children,
  onDismiss,
}: {
  model: string;
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <section
      aria-label="AI-generated draft"
      className="rounded-lg border border-navy-100 bg-navy-50/40 p-3.5"
    >
      <header className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest text-navy-700">
          <Sparkles size={13} aria-hidden="true" />
          AI-generated draft
        </p>
        <span className="font-mono text-2xs text-ink-subtle">{model}</span>
      </header>

      {children}

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-navy-100 pt-2.5">
        <p className="text-2xs text-ink-subtle">
          Nothing is saved. Read it, change what is wrong, and put it where it belongs yourself.
        </p>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="text-2xs font-medium text-ink-muted underline underline-offset-2 hover:text-navy-800"
          >
            Dismiss
          </button>
        ) : null}
      </footer>
    </section>
  );
}

/** The failure shape every assist shares: honest, never a fabricated answer. */
export function AIError({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red">
      <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

/** Copy shown where an assist would be, when no provider is configured. */
export function AIUnavailable() {
  return (
    <p className="text-2xs text-ink-subtle">
      No AI provider is configured, so drafting is switched off. Set{" "}
      <code className="font-mono">AI_PROVIDER</code> and{" "}
      <code className="font-mono">AI_API_KEY</code> to enable it.
    </p>
  );
}
