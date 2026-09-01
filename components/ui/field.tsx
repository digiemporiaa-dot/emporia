import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Form primitives.
 *
 * Every input is labelled and every error is wired through `aria-describedby`
 * and `aria-invalid` (CLAUDE.md 12) — a red border alone is not an error
 * message a screen reader can read.
 */

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label
      className={cn("block text-xs font-medium text-ink-muted tracking-wide", className)}
      {...props}
    >
      {children}
      {required ? (
        <span className="text-brand-red" aria-hidden="true">
          {" *"}
        </span>
      ) : null}
    </label>
  );
}

const CONTROL_BASE =
  "w-full rounded-md border border-line-strong bg-white px-3 text-sm text-ink " +
  "placeholder:text-ink-subtle transition-colors duration-(--duration-fast) " +
  "hover:border-navy-300 focus:border-brand-red focus:outline-none focus:ring-3 focus:ring-brand-red/25 " +
  "disabled:bg-surface-sunken disabled:text-ink-subtle " +
  "aria-[invalid=true]:border-brand-red aria-[invalid=true]:ring-3 aria-[invalid=true]:ring-brand-red/20";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL_BASE, "h-9.5", className)} {...props} />;
});

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={cn(CONTROL_BASE, "h-9.5 pr-8", className)} {...props} />;
});

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(CONTROL_BASE, "py-2 min-h-20", className)} {...props} />;
});

export function FieldError({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="text-xs text-brand-red">
      {children}
    </p>
  );
}

export function Hint({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="text-xs text-ink-subtle">
      {children}
    </p>
  );
}

/** Label + control + hint/error, with the aria wiring already correct. */
export function Field({
  id,
  label,
  required,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  children: (aria: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {children({
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        ...(error ? { "aria-invalid": true as const } : {}),
      })}
      <Hint id={hintId}>{hint}</Hint>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}
