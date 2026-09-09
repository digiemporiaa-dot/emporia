"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * A call to action that follows the visitor down the page.
 *
 * Three channels, one component: a link goes through `next/link`, WhatsApp and
 * phone are ordinary anchors with a scheme. Building `wa.me` and `tel:` URLs
 * here rather than storing them means an editor types a number, not a URL, and
 * cannot paste something else into an href.
 *
 * Dismissal is per-session and lives in `sessionStorage`, so closing it does
 * not silence the bar forever on a device someone shares — and a browser that
 * refuses storage still gets a working bar rather than an error.
 */

export type StickyChannel = "link" | "whatsapp" | "phone";

/** Digits only: what both `wa.me` and `tel:` actually want. */
function digits(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function destination(channel: StickyChannel, target: string, prefill?: string): string | null {
  if (channel === "link") return target.startsWith("/") ? target : null;

  const number = digits(target);
  // Too short to be a real international number; rendering a dead button is
  // worse than rendering nothing.
  if (number.length < 8) return null;

  if (channel === "phone") return `tel:+${number}`;
  const text = prefill ? `?text=${encodeURIComponent(prefill)}` : "";
  return `https://wa.me/${number}${text}`;
}

export function StickyCta({
  text,
  buttonLabel,
  channel,
  target,
  prefill,
  position,
  dismissible,
  showAfterScroll,
}: {
  text: string;
  buttonLabel: string;
  channel: StickyChannel;
  target: string;
  prefill?: string | undefined;
  position: "bottom" | "top";
  dismissible: boolean;
  showAfterScroll: number;
}) {
  const href = destination(channel, target, prefill);
  const storageKey = `em_sticky_${channel}_${buttonLabel}`;

  const [dismissed, setDismissed] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(showAfterScroll === 0);

  React.useEffect(() => {
    try {
      if (sessionStorage.getItem(storageKey) === "1") setDismissed(true);
    } catch {
      // A browser refusing storage gets the bar, which is the safer default.
    }
  }, [storageKey]);

  React.useEffect(() => {
    if (showAfterScroll === 0) return;
    const onScroll = () => {
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const percent = height > 0 ? (window.scrollY / height) * 100 : 100;
      if (percent >= showAfterScroll) setScrolled(true);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [showAfterScroll]);

  if (!href || dismissed || !scrolled) return null;

  const close = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch {
      // Dismissed for this render either way.
    }
  };

  const button =
    "inline-flex h-9.5 shrink-0 items-center rounded-md bg-brand-red px-4 text-sm font-medium text-white transition-colors hover:bg-red-600";

  return (
    <aside
      // A complementary landmark, labelled, so it is skippable rather than an
      // unexplained region a screen reader user meets on every page.
      aria-label="Call to action"
      className={cn(
        "fixed inset-x-0 z-40 border-line bg-white/95 px-4 py-3 backdrop-blur-sm",
        position === "bottom" ? "bottom-0 border-t" : "top-0 border-b",
      )}
    >
      <div className="mx-auto flex max-w-(--container-page) items-center gap-4">
        <p className="min-w-0 flex-1 truncate text-sm text-navy-800">{text}</p>
        {channel === "link" ? (
          <Link href={href as Route} className={button}>
            {buttonLabel}
          </Link>
        ) : (
          <a href={href} className={button} rel="noopener noreferrer">
            {buttonLabel}
          </a>
        )}
        {dismissible ? (
          <button
            type="button"
            onClick={close}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-subtle hover:bg-surface-muted hover:text-navy-800"
          >
            <X size={16} aria-hidden="true" />
            <span className="sr-only">Dismiss</span>
          </button>
        ) : null}
      </div>
    </aside>
  );
}
