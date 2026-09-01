import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Button primitive. A Server Component by default — it carries no state, so it
 * needs no `"use client"` (CLAUDE.md 2 rule 8).
 */

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  // Red is the accent that marks the primary action, and only that.
  primary:
    "bg-brand-red text-white border border-transparent hover:bg-red-600 active:bg-red-700 disabled:bg-navy-300",
  secondary:
    "bg-white text-navy-800 border border-line-strong hover:bg-surface-muted hover:border-navy-300 active:bg-surface-sunken",
  ghost:
    "bg-transparent text-ink-muted border border-transparent hover:bg-surface-muted hover:text-navy-800",
  danger:
    "bg-white text-brand-red border border-red-100 hover:bg-red-50 hover:border-brand-red",
  link: "bg-transparent text-brand-red border-0 underline underline-offset-4 hover:text-red-700 p-0 h-auto",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-9.5 px-4 text-sm gap-2",
  lg: "h-11 px-6 text-base gap-2",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium",
        "transition-colors duration-(--duration-fast) ease-(--ease-out-soft)",
        "disabled:pointer-events-none disabled:opacity-60",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red",
        VARIANTS[variant],
        variant === "link" ? "" : SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
