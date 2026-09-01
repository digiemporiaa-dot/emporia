"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Accessible modal dialog.
 *
 * Built on the native <dialog> element, which gives a real focus trap, Esc to
 * close, and focus restoration from the platform rather than from hand-written
 * key handling (CLAUDE.md 10, 12).
 *
 * `"use client"` is genuine here: this needs refs, effects and event handlers.
 */

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descId = React.useId();

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Esc fires `cancel`; forward it so the parent's state stays in sync.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClick={(event) => {
        // Backdrop click: the dialog element itself is the backdrop area.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-white p-0 text-ink shadow-lg",
        "backdrop:bg-navy-900/40",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
        <div>
          <h2 id={titleId} className="text-sm font-semibold text-navy-800">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="mt-0.5 text-xs text-ink-subtle">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm p-1 text-ink-subtle transition-colors hover:bg-surface-muted hover:text-navy-800"
        >
          <X size={16} aria-hidden="true" />
          <span className="sr-only">Close</span>
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer ? (
        <div className="flex justify-end gap-2 border-t border-line bg-surface-muted px-5 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
