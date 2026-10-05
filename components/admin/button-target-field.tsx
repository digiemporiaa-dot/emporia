"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { Input, Select } from "@/components/ui";
import { popupTarget, popupTargetId } from "@/lib/popups/button-target";

/**
 * Where a button goes: a page on this site, or a popup it opens.
 *
 * The choice is stored in the button's link field — `/path` or `popup:<id>`
 * (lib/popups/button-target) — so blocks and the header need no second field.
 * The popups offered are the ones whose trigger is "Button click"; the server
 * checks the value again on save and when the button is clicked.
 */

export type ButtonPopupOption = { id: string; name: string; isActive: boolean };

const ButtonPopupsContext = React.createContext<readonly ButtonPopupOption[]>([]);

export function ButtonPopupsProvider({ popups, children }: { popups: readonly ButtonPopupOption[]; children: React.ReactNode }) {
  return <ButtonPopupsContext.Provider value={popups}>{children}</ButtonPopupsContext.Provider>;
}

export function ButtonTargetField({
  label,
  value,
  onChange,
  placeholder = "/contact",
  hint,
  error,
  tone = "caps",
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string | undefined;
  /** "caps" matches the builder's small uppercase labels; "plain" matches form fields. */
  tone?: "caps" | "plain";
}) {
  const popups = React.useContext(ButtonPopupsContext);
  const id = React.useId();
  const chosen = popupTargetId(value);
  const [mode, setMode] = React.useState<"page" | "popup">(chosen ? "popup" : "page");
  const option = chosen ? popups.find((popup) => popup.id === chosen) : undefined;

  const switchTo = (next: "page" | "popup") => {
    setMode(next);
    if (next === "page") onChange(chosen ? "" : value);
    else {
      const first = popups.find((popup) => popup.isActive) ?? popups[0];
      onChange(first ? popupTarget(first.id) : "");
    }
  };

  const labelClass = tone === "caps" ? "mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle" : "mb-1.5 block text-sm font-medium text-navy-800";

  return (
    <div>
      <span className={labelClass} aria-hidden="true">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">
        <Select aria-label={`${label}: action`} value={mode} onChange={(e) => switchTo(e.target.value as "page" | "popup")} className="w-auto">
          <option value="page">Go to a page</option>
          <option value="popup">Open a popup</option>
        </Select>
        {mode === "page" ? (
          <Input
            aria-label={`${label}: page`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
            value={chosen ? "" : value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1"
          />
        ) : popups.length === 0 ? null : (
          <Select
            aria-label={`${label}: popup to open`}
            aria-invalid={error ? true : undefined}
            value={chosen ?? ""}
            onChange={(e) => onChange(e.target.value ? popupTarget(e.target.value) : "")}
            className="min-w-0 flex-1"
          >
            {!option ? <option value="">{chosen ? "A popup that no longer exists" : "Choose a popup"}</option> : null}
            {popups.map((popup) => (
              <option key={popup.id} value={popup.id}>
                {popup.name}
                {popup.isActive ? "" : " (switched off)"}
              </option>
            ))}
          </Select>
        )}
      </div>
      {mode === "popup" && popups.length === 0 ? (
        <p className="mt-1.5 text-xs text-ink-subtle">
          No button popups yet.{" "}
          <Link href={"/admin/marketing/popups/new" as Route} className="text-navy-800 underline underline-offset-2">
            Create one
          </Link>{" "}
          with the trigger &ldquo;Button click&rdquo;, then choose it here.
        </p>
      ) : null}
      {mode === "popup" && option && !option.isActive ? (
        <p className="mt-1.5 text-xs text-warning">This popup is switched off: the button does nothing until it is switched on.</p>
      ) : null}
      {mode === "popup" && chosen && !option ? (
        <p className="mt-1.5 text-xs text-brand-red-text">That popup was deleted or is no longer a button popup. Choose another.</p>
      ) : null}
      {hint && mode === "page" && !error ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-brand-red-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
