import Link from "next/link";
import type { Route } from "next";
import { Badge, Button, Select } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

/** Pieces shared by the Site crawl, Technical SEO and Indexation screens. */

export const DATE_TIME = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-1 font-display text-2xl tabular-nums text-navy-800">{value}</p>
      {note ? <p className="mt-0.5 text-2xs text-ink-subtle">{note}</p> : null}
    </div>
  );
}

const SEVERITY_TONE = { CRITICAL: "red", WARNING: "warning", NOTICE: "neutral" } as const;
const SEVERITY_LABEL = { CRITICAL: "Critical", WARNING: "Warning", NOTICE: "Notice" } as const;

export function SeverityBadge({ severity }: { severity: keyof typeof SEVERITY_TONE }) {
  return <Badge tone={SEVERITY_TONE[severity]}>{SEVERITY_LABEL[severity]}</Badge>;
}

const RUN_TONE = { RUNNING: "navy", SUCCEEDED: "success", FAILED: "red", CANCELLED: "neutral" } as const;
const RUN_LABEL = { RUNNING: "Running", SUCCEEDED: "Finished", FAILED: "Failed", CANCELLED: "Cancelled" } as const;

export function RunBadge({ status }: { status: keyof typeof RUN_TONE }) {
  return <Badge tone={RUN_TONE[status]}>{RUN_LABEL[status]}</Badge>;
}

/** The website selector, a plain GET form so the choice lives in the URL. */
export function PropertyPicker({
  id,
  properties,
  current,
  hidden = {},
}: {
  id: string;
  properties: readonly { id: string; displayName: string; client: { name: string } }[];
  current: string;
  hidden?: Record<string, string>;
}) {
  return (
    <form className="mb-4 flex flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label htmlFor={id} className="sr-only">
        Website
      </label>
      <Select id={id} name="property" defaultValue={current} className="w-full max-w-sm">
        {properties.map((option) => (
          <option key={option.id} value={option.id}>
            {option.client.name} — {option.displayName}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="secondary">
        Show
      </Button>
    </form>
  );
}

/** A row of filter links; the current one is filled. */
export function FilterLinks({
  label,
  items,
}: {
  label: string;
  items: readonly { key: string; label: string; href: Route; current: boolean; count?: number }[];
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.current ? "page" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs",
            item.current ? "bg-navy-800 font-medium text-white" : "border border-line bg-white text-ink-muted hover:text-navy-800",
          )}
        >
          {item.label}
          {item.count !== undefined ? <span className="ml-1 tabular-nums opacity-80">{item.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** A URL, truncated, opening the live page. */
export function UrlCell({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" title={url} className="block truncate font-mono text-2xs text-navy-800 hover:text-brand-red">
      {url}
    </a>
  );
}
