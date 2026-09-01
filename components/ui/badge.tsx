import * as React from "react";
import { cn } from "@/lib/utils/cn";

type Tone = "neutral" | "navy" | "red" | "success" | "warning";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-ink-muted border-line-strong",
  navy: "bg-navy-50 text-navy-700 border-navy-100",
  red: "bg-red-50 text-brand-red border-red-100",
  success: "bg-success-bg text-success border-success/20",
  warning: "bg-warning-bg text-warning border-warning/20",
};

export function Badge({
  className,
  tone = "neutral",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
