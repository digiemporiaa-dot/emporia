import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Data table primitive for the admin surface: dense, professional, fast
 * (CLAUDE.md 6). The wrapper scrolls horizontally so a wide table never makes
 * the page itself scroll sideways.
 */

export function TableWrap({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("w-full overflow-x-auto rounded-lg border border-line bg-white", className)}
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
