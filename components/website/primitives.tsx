import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Route } from "next";
import { cn } from "@/lib/utils/cn";

export function Container({
  className,
  children,
  width = "page",
}: {
  className?: string;
  children: React.ReactNode;
  width?: "page" | "narrow" | "wide";
}) {
  const widths = {
    page: "max-w-(--container-page)",
    narrow: "max-w-(--container-narrow)",
    wide: "max-w-(--container-wide)",
  } as const;

  return (
    <div className={cn("mx-auto px-5 lg:px-8", widths[width], className)}>{children}</div>
  );
}

/** Small uppercase label that opens a section. Carries the red accent. */
export function Eyebrow({
  children,
  tone = "red",
  className,
}: {
  children: React.ReactNode;
  tone?: "red" | "muted" | "light";
  className?: string;
}) {
  const tones = {
    red: "text-brand-red",
    muted: "text-ink-subtle",
    light: "text-navy-300",
  } as const;

  return (
    <p
      className={cn(
        "text-2xs font-semibold uppercase tracking-widest",
        tones[tone],
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Text link with a moving arrow. Motion is on hover only. */
export function ArrowLink({
  href,
  children,
  tone = "dark",
  className,
}: {
  href: Route | { pathname: string; query?: Record<string, string> };
  children: React.ReactNode;
  tone?: "dark" | "light" | "red";
  className?: string;
}) {
  const tones = {
    dark: "text-navy-800 hover:text-brand-red",
    light: "text-white hover:text-navy-100",
    red: "text-brand-red hover:text-red-700",
  } as const;

  return (
    <Link
      href={href as Route}
      className={cn(
        "group inline-flex items-center gap-1.5 text-sm font-medium transition-colors duration-(--duration-fast)",
        tones[tone],
        className,
      )}
    >
      {children}
      <ArrowRight
        size={15}
        aria-hidden="true"
        className="transition-transform duration-(--duration-base) ease-(--ease-out-soft) group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
      />
    </Link>
  );
}

/** Solid call-to-action. Red is reserved for the primary action. */
export function CtaButton({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href: Route | { pathname: string; query?: Record<string, string> };
  children: React.ReactNode;
  variant?: "primary" | "outline" | "onDark";
  size?: "md" | "lg";
  className?: string;
}) {
  const variants = {
    primary: "bg-brand-red text-white hover:bg-red-600",
    outline: "border border-line-strong text-navy-800 hover:border-navy-300 hover:bg-surface-muted",
    onDark: "border border-navy-500 text-white hover:bg-navy-700",
  } as const;

  const sizes = { md: "h-10 px-5 text-sm", lg: "h-12 px-6 text-base" } as const;

  return (
    <Link
      href={href as Route}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors duration-(--duration-fast)",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Hairline rule used to separate bands and rows. */
export function Rule({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("h-px w-full", tone === "dark" ? "bg-navy-700" : "bg-line", className)}
    />
  );
}

/** Two-digit index number. Editorial device used across the site. */
export function IndexNumber({
  value,
  tone = "muted",
  className,
}: {
  value: number;
  tone?: "muted" | "light" | "red";
  className?: string;
}) {
  const tones = {
    muted: "text-ink-subtle",
    light: "text-navy-300",
    red: "text-brand-red",
  } as const;

  return (
    <span
      aria-hidden="true"
      className={cn("text-2xs font-semibold tabular-nums tracking-widest", tones[tone], className)}
    >
      {String(value).padStart(2, "0")}
    </span>
  );
}
