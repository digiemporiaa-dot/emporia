import Link from "next/link";
import type { Route } from "next";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Badge } from "@/components/ui";
import type { MetricPair } from "@/lib/services/seo-intel/overview.service";
import type { ChangeInsight } from "@/lib/seo-intel/engine/changes";
import type { GscMetrics } from "@/lib/seo-intel/normalize/gsc";
import { cn } from "@/lib/utils/cn";

/** Pieces of the SEO overview. Server components: everything is in text, nothing hover-only. */

const COUNT = new Intl.NumberFormat("en-IN");
const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export const formatCount = (value: number) => COUNT.format(value);
export const formatPct = (fraction: number | null, digits = 1) => (fraction === null ? "—" : `${(fraction * 100).toFixed(digits)}%`);
export const formatPosition = (value: number | null) => (value === null || value === 0 ? "—" : value.toFixed(1));
export const formatDay = (day: string) => DAY.format(new Date(`${day}T00:00:00Z`));
export const formatRange = (range: { start: string; end: string }) =>
  range.start === range.end ? formatDay(range.start) : `${formatDay(range.start)} – ${formatDay(range.end)}`;

/**
 * Change against the previous period. `higherIsBetter` decides the arrow's
 * meaning; the words say it too, so color is never the only signal.
 */
export function Delta({ pair, kind, higherIsBetter = true }: { pair: MetricPair; kind: "relative" | "absolute"; higherIsBetter?: boolean }) {
  if (pair.previous === null) return <span className="text-2xs text-ink-subtle">No earlier data</span>;
  if (pair.change === null) return <span className="text-2xs text-ink-subtle">New</span>;
  const flat = kind === "relative" ? Math.abs(pair.change) < 0.005 : Math.abs(pair.change) < 0.05;
  if (flat) {
    return (
      <span className="inline-flex items-center gap-0.5 text-2xs text-ink-subtle">
        <Minus size={12} aria-hidden="true" /> No change
      </span>
    );
  }
  const up = pair.change > 0;
  const good = up === higherIsBetter;
  const text = kind === "relative" ? `${up ? "+" : "−"}${Math.abs(pair.change * 100).toFixed(1)}%` : `${up ? "+" : "−"}${Math.abs(pair.change).toFixed(1)}`;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-2xs font-medium", good ? "text-success" : "text-brand-red-text")}>
      <Icon size={12} aria-hidden="true" />
      {text}
      <span className="sr-only">{good ? " (better)" : " (worse)"}</span>
    </span>
  );
}

export function Kpi({
  label,
  value,
  pair,
  kind = "relative",
  higherIsBetter = true,
  note,
}: {
  label: string;
  value: string;
  pair: MetricPair;
  kind?: "relative" | "absolute";
  higherIsBetter?: boolean;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <p className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-1 font-display text-2xl tabular-nums text-navy-800">{value}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
        <Delta pair={pair} kind={kind} higherIsBetter={higherIsBetter} />
        {note ? <span className="text-2xs text-ink-subtle">{note}</span> : null}
      </div>
    </div>
  );
}

const SEVERITY: Record<ChangeInsight["severity"], { tone: "red" | "warning" | "neutral"; label: string }> = {
  high: { tone: "red", label: "High" },
  medium: { tone: "warning", label: "Medium" },
  low: { tone: "neutral", label: "Low" },
};

export function ChangeList({ changes, propertyId, period }: { changes: readonly ChangeInsight[]; propertyId: string; period: string }) {
  if (changes.length === 0) {
    return <p className="text-sm text-ink-subtle">Nothing moved beyond the thresholds in this period.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {changes.map((change) => {
        const params = new URLSearchParams({ property: propertyId, period });
        if (change.view !== "overview") {
          params.set("view", change.view);
          for (const key of change.entity.keys.slice(0, 20)) params.append("key", key);
        }
        const href = (change.view === "overview" ? `/admin/marketing/seo?${params}` : `/admin/marketing/seo/performance?${params}`) as Route;
        return (
          <li key={change.key} className="flex flex-wrap items-start justify-between gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-navy-800">
                <span className="mr-2 align-middle">
                  <Badge tone={SEVERITY[change.severity].tone}>{SEVERITY[change.severity].label}</Badge>
                </span>
                {change.title}
              </p>
              <p className="mt-0.5 text-2xs text-ink-subtle">
                {change.source} · {formatRange(change.range.current)} vs {formatRange(change.range.previous)}
                {change.entity.keys.length ? ` · ${change.entity.keys.length > 1 ? `${change.entity.keys.length} ${change.entity.type === "page" ? "pages" : "queries"}` : change.entity.keys[0]}` : ""}
              </p>
            </div>
            {change.view !== "overview" ? (
              <Link href={href} className="shrink-0 text-xs text-navy-800 underline underline-offset-2 hover:text-brand-red">
                See details
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** A compact table of top queries or pages with their change in clicks. */
export function TopTable({
  rows,
  label,
  isUrl = false,
}: {
  rows: readonly { key: string; current: GscMetrics; previous: GscMetrics | null }[];
  label: string;
  isUrl?: boolean;
}) {
  if (rows.length === 0) return <p className="text-sm text-ink-subtle">No {label.toLowerCase()} in this period.</p>;
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="text-2xs uppercase tracking-wide text-ink-subtle">
            <th scope="col" className="py-1.5 pr-3 font-medium">{isUrl ? "Page" : "Query"}</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">Clicks</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-medium">Impr.</th>
            <th scope="col" className="py-1.5 text-right font-medium">Pos.</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => {
            const change = row.previous && row.previous.clicks > 0 ? (row.current.clicks - row.previous.clicks) / row.previous.clicks : null;
            return (
              <tr key={row.key}>
                <td className="max-w-[18rem] py-1.5 pr-3">
                  <span className={cn("block truncate text-navy-800", isUrl && "font-mono text-2xs")} title={row.key}>
                    {isUrl ? row.key.replace(/^https?:\/\/[^/]+/, "") || "/" : row.key}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {formatCount(row.current.clicks)}
                  {change !== null && Math.abs(change) >= 0.005 ? (
                    <span className={cn("ml-1 text-2xs", change > 0 ? "text-success" : "text-brand-red-text")}>
                      {change > 0 ? "+" : "−"}
                      {Math.abs(change * 100).toFixed(0)}%
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">{formatCount(row.current.impressions)}</td>
                <td className="py-1.5 text-right tabular-nums text-ink-muted">{formatPosition(row.current.position)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
