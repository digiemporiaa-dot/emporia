import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Data table primitive for the admin surface: dense, professional, fast
 * (CLAUDE.md 6). The wrapper scrolls horizontally so a wide table never makes
 * the page itself scroll sideways.
 */

export function TableWrap({
  className,
  label = "Table",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { label?: string }) {
  return (
    <div
      // A horizontally scrolling region has to be reachable by keyboard, or the
      // columns past the right edge are mouse-only. Rows normally contain links
      // that provide that focus, but an empty table has none — which is exactly
      // when axe reports scrollable-region-focusable, and exactly when a
      // keyboard user is most stuck. `tabIndex` plus a named region fixes both
      // cases (WCAG 2.1.1; CLAUDE.md 12).
      role="region"
      aria-label={label}
      tabIndex={0}
      // `relative` is load-bearing: it makes this the containing block for any
      // absolutely positioned descendant (an .sr-only label, for instance), so
      // such elements are clipped by this scroller instead of escaping to the
      // viewport and widening the whole page.
      className={cn(
        "relative w-full overflow-x-auto rounded-lg border border-line bg-white",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red",
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...props} />;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("bg-surface-muted", className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-line", className)} {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("transition-colors duration-(--duration-instant) hover:bg-navy-50/60", className)}
      {...props}
    />
  );
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-line px-3 py-2 text-left text-2xs font-semibold uppercase tracking-widest text-ink-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2.5 align-middle text-ink", className)} {...props} />;
}

/** Empty state. Shown instead of inventing rows (CLAUDE.md 2 rule 5). */
export function TableEmpty({
  colSpan,
  title,
  description,
  action,
}: {
  colSpan: number;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-14 text-center">
        <p className="text-sm font-medium text-navy-800">{title}</p>
        {description ? <p className="mt-1 text-xs text-ink-subtle">{description}</p> : null}
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </td>
    </tr>
  );
}
