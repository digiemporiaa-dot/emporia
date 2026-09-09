"use client";

import * as React from "react";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Desktop / tablet / phone preview.
 *
 * The frame is a real iframe at the device's width, because Tailwind's
 * breakpoints key off the viewport: a narrowed `<div>` still matches `lg:`, so
 * a preview built that way shows the desktop layout squeezed rather than the
 * mobile one. See app/preview-frame/[pageId].
 *
 * Desktop renders the page inline instead of framing it, so the common case
 * costs no second document load and keeps the browser's own width.
 */

type Device = "desktop" | "tablet" | "mobile";

/** Widths chosen to sit just inside each Tailwind breakpoint, not on it. */
const WIDTH: Record<Exclude<Device, "desktop">, number> = {
  tablet: 834,
  mobile: 390,
};

const DEVICES: { id: Device; label: string; Icon: typeof Monitor }[] = [
  { id: "desktop", label: "Desktop", Icon: Monitor },
  { id: "tablet", label: "Tablet", Icon: Tablet },
  { id: "mobile", label: "Phone", Icon: Smartphone },
];

export function DevicePreview({ pageId, children }: { pageId: string; children: React.ReactNode }) {
  const [device, setDevice] = React.useState<Device>("desktop");

  return (
    <>
      <div
        role="group"
        aria-label="Preview width"
        className="inline-flex items-center gap-0.5 rounded-md border border-line-strong bg-white p-0.5"
      >
        {DEVICES.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setDevice(id)}
            aria-pressed={device === id}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors",
              device === id
                ? "bg-navy-800 text-white"
                : "text-ink-muted hover:bg-surface-muted hover:text-navy-800",
            )}
          >
            <Icon size={13} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {device === "desktop" ? (
        <div className="bg-white">{children}</div>
      ) : (
        <div className="flex justify-center bg-surface-sunken px-4 py-6">
          <iframe
            // Keyed on the device so switching remounts at the new width rather
            // than resizing a document that has already laid itself out.
            key={device}
            src={`/preview-frame/${pageId}`}
            title={`${device === "tablet" ? "Tablet" : "Phone"} preview`}
            width={WIDTH[device]}
            className="h-[80vh] rounded-lg border border-line-strong bg-white shadow-sm"
          />
        </div>
      )}
    </>
  );
}
