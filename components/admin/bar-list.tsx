/**
 * Horizontal bars for admin analytics. A server component: nothing here is
 * hover-only — each bar carries its value and sample size in text — so it
 * needs no client code. Marks are navy; the one highlighted bar is red and
 * labelled "Best" in text (see `charts.tsx` for why charts here are
 * single-series).
 */

const MARK = "var(--color-navy-500)";
const NUMBER = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

export type BarDatum = {
  key: string;
  label: string;
  /** Null draws no bar and says why, in `note`. */
  value: number | null;
  note: string;
};

/**
 * Horizontal bars with their value at the tip and the sample size beside it,
 * so nothing is hover-only. One bar may be highlighted — in red, and labelled
 * "Best" in text.
 */
export function BarList({
  data,
  highlight,
  unit,
  label,
}: {
  data: readonly BarDatum[];
  highlight: string | null;
  unit: "count" | "percent";
  label: string;
}) {
  const format = (value: number) => (unit === "percent" ? `${value.toFixed(2)}%` : NUMBER.format(value));
  const max = Math.max(0, ...data.map((d) => d.value ?? 0));
  return (
    <ul aria-label={label} className="space-y-1.5">
      {data.map((d) => {
        const best = d.key === highlight;
        const width = d.value === null || max === 0 ? 0 : Math.max(2, (d.value / max) * 100);
        return (
          <li key={d.key} className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2 text-2xs">
            <span className="text-ink-subtle">{d.label}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="relative h-3.5 min-w-0 flex-1">
                {d.value !== null ? (
                  <span
                    className="absolute inset-y-0 left-0 rounded-r-sm"
                    style={{ width: `${width}%`, background: best ? "var(--color-brand-red)" : MARK }}
                  />
                ) : null}
              </span>
              <span className="w-48 shrink-0 tabular-nums text-navy-800">
                {d.value === null ? <span className="text-ink-subtle">—</span> : format(d.value)}
                <span className="ml-1 text-ink-subtle">{d.note}</span>
                {best ? <span className="ml-1 font-semibold text-brand-red-text">Best</span> : null}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
