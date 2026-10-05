"use client";

import * as React from "react";

/**
 * Small, single-series charts for admin analytics.
 *
 * Deliberately single-series: the brand allows navy and red only (CLAUDE.md
 * 6), so identity between several series could not be carried by color. Two
 * measures are two charts, never two axes. Marks are navy; red is reserved for
 * the one highlighted item, which is also labelled in text so it never relies
 * on color alone. Every chart has a table view, and a gap in the data (a day
 * nothing was reported) is drawn as a gap, not as zero.
 */

const MARK = "var(--color-navy-500)";
const WASH = "var(--color-navy-100)";
const GRID = "var(--color-line)";
const COUNT = new Intl.NumberFormat("en-IN");
const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude >= value) ?? 10;
  return step * magnitude;
}

export type TrendDatum = { day: string; value: number | null };

/**
 * A daily line with an area wash, a crosshair that snaps to the nearest day,
 * and the same readout on keyboard focus (arrow keys) as on hover.
 */
export function TrendChart({
  title,
  data,
  variant = "count",
  emptyText = "No platform reported this in the period.",
}: {
  title: string;
  data: readonly TrendDatum[];
  /** "position": a rank where 1 is best — the axis runs from 1 at the top, values are averages, nothing is summed. */
  variant?: "count" | "position";
  emptyText?: string;
}) {
  const isPosition = variant === "position";
  const format = (v: number) => (isPosition ? v.toFixed(1) : COUNT.format(v));
  const id = React.useId();
  const [active, setActive] = React.useState<number | null>(null);
  const width = 560;
  const height = 180;
  const pad = { top: 12, right: 12, bottom: 24, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  const min = isPosition ? 1 : Math.min(0, ...values);
  const max = isPosition ? Math.max(niceMax(Math.max(...values, 2)), 2) : niceMax(Math.max(0, ...values));
  const x = (i: number) => pad.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) =>
    isPosition ? pad.top + ((v - min) / (max - min || 1)) * innerH : pad.top + innerH - ((v - min) / (max - min || 1)) * innerH;

  // Split at nulls, so an unreported day is a gap in the line.
  const segments: { i: number; v: number }[][] = [];
  let current: { i: number; v: number }[] = [];
  data.forEach((d, i) => {
    if (d.value === null) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push({ i, v: d.value });
  });
  if (current.length) segments.push(current);

  const ticks = [min, (min + max) / 2, max];
  const labelDays = data.length > 0 ? [0, Math.floor((data.length - 1) / 2), data.length - 1] : [];
  const reported = values.length;
  const total = values.reduce((a, b) => a + b, 0);

  const onPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const i = Math.round(((px - pad.left) / innerW) * (data.length - 1));
    setActive(Math.max(0, Math.min(data.length - 1, i)));
  };
  const onKey = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setActive((i) => {
      const start = i ?? data.length - 1;
      return Math.max(0, Math.min(data.length - 1, start + (event.key === "ArrowLeft" ? -1 : 1)));
    });
  };
  const point = active !== null ? data[active] : null;

  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-navy-800">{title}</span>
        <span className="text-2xs text-ink-subtle">
          {reported === 0
            ? "Not reported"
            : isPosition
              ? `${reported} of ${data.length} days reported · 1 is the top`
              : `${COUNT.format(total)} over the period · ${reported} of ${data.length} days reported`}
        </span>
      </figcaption>
      {reported === 0 ? (
        <p className="mt-2 rounded-md border border-dashed border-line-strong px-3 py-8 text-center text-2xs text-ink-subtle">
          {emptyText}
        </p>
      ) : (
        <div className="relative mt-2">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full touch-none select-none focus-visible:outline-2 focus-visible:outline-brand-red"
            role="img"
            aria-label={`${title}, daily. Use left and right arrow keys to read each day.`}
            aria-describedby={`${id}-readout`}
            tabIndex={0}
            onPointerMove={onPointer}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
                <text x={pad.left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--color-ink-subtle)">
                  {isPosition ? Math.round(t) : COUNT.format(Math.round(t))}
                </text>
              </g>
            ))}
            {labelDays.map((i) => (
              <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} fontSize={10} fill="var(--color-ink-subtle)">
                {DAY.format(new Date(`${data[i]!.day}T00:00:00Z`))}
              </text>
            ))}
            {segments.map((segment, s) => (
              <g key={s}>
                {segment.length > 1 && !isPosition ? (
                  <path
                    d={`M${x(segment[0]!.i)},${y(Math.max(min, 0))} ${segment.map((p) => `L${x(p.i)},${y(p.v)}`).join(" ")} L${x(segment[segment.length - 1]!.i)},${y(Math.max(min, 0))} Z`}
                    fill={WASH}
                    opacity={0.6}
                  />
                ) : null}
                <path
                  d={segment.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.v)}`).join(" ")}
                  fill="none"
                  stroke={MARK}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {segment.length === 1 ? <circle cx={x(segment[0]!.i)} cy={y(segment[0]!.v)} r={4} fill={MARK} stroke="white" strokeWidth={2} /> : null}
              </g>
            ))}
            {active !== null ? (
              <g pointerEvents="none">
                <line x1={x(active)} x2={x(active)} y1={pad.top} y2={pad.top + innerH} stroke="var(--color-navy-300)" strokeWidth={1} />
                {point?.value !== null && point ? (
                  <circle cx={x(active)} cy={y(point.value)} r={4} fill={MARK} stroke="white" strokeWidth={2} />
                ) : null}
              </g>
            ) : null}
          </svg>
          <div
            id={`${id}-readout`}
            aria-live="polite"
            className={`pointer-events-none absolute top-0 rounded-md border border-line bg-white px-2 py-1 text-2xs shadow-sm ${point ? "" : "sr-only"}`}
            style={point && active !== null ? { left: `${Math.min(80, Math.max(0, (x(active) / width) * 100 - 8))}%` } : undefined}
          >
            {point ? (
              <>
                <span className="block text-sm font-semibold tabular-nums text-navy-800">
                  {point.value === null ? "Not reported" : format(point.value)}
                </span>
                <span className="text-ink-subtle">{DAY.format(new Date(`${point.day}T00:00:00Z`))}</span>
              </>
            ) : null}
          </div>
        </div>
      )}
      {reported > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-2xs text-ink-subtle">Table view</summary>
          <table className="mt-1 w-full text-2xs">
            <thead>
              <tr className="text-left text-ink-subtle">
                <th className="py-0.5 font-medium">Day</th>
                <th className="py-0.5 text-right font-medium">{title}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.day} className="border-t border-line">
                  <td className="py-0.5">{DAY.format(new Date(`${d.day}T00:00:00Z`))}</td>
                  <td className="py-0.5 text-right tabular-nums">{d.value === null ? "Not reported" : format(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </figure>
  );
}

export type BarDatum = {
  key: string;
  /** Axis label, e.g. "Sep 26". */
  label: string;
  /** Null: nothing reported — drawn as an empty slot, never as zero. */
  value: number | null;
  /** Shown instead of the plain number, e.g. a formatted amount. */
  display?: string;
  /** A qualifier for the readout, e.g. "18 of 30 days". */
  note?: string;
};

/**
 * Single-series bars over periods (months, weeks, crawls). Same rules as the
 * trend chart: navy marks, one axis, a hover and keyboard readout, a table
 * view, and an unreported period left empty rather than drawn at zero.
 */
export function BarChart({ title, data, emptyText = "Nothing reported yet." }: { title: string; data: readonly BarDatum[]; emptyText?: string }) {
  const id = React.useId();
  const [active, setActive] = React.useState<number | null>(null);
  const width = 560;
  const height = 180;
  const pad = { top: 12, right: 8, bottom: 24, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const values = data.map((d) => d.value).filter((v): v is number => v !== null);
  const max = niceMax(Math.max(0, ...values));
  const slot = data.length ? innerW / data.length : innerW;
  // A 2px surface gap between neighbours, bars never thinner than 2px.
  const barW = Math.max(2, slot - 2);
  const y = (v: number) => pad.top + innerH - (Math.max(0, v) / max) * innerH;
  const show = (d: BarDatum) => (d.value === null ? "Not reported" : (d.display ?? COUNT.format(d.value)));
  const labelAt = data.length > 0 ? [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])] : [];
  const point = active !== null ? data[active] : null;

  const onPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    setActive(Math.max(0, Math.min(data.length - 1, Math.floor((px - pad.left) / slot))));
  };
  const onKey = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setActive((i) => Math.max(0, Math.min(data.length - 1, (i ?? data.length - 1) + (event.key === "ArrowLeft" ? -1 : 1))));
  };

  return (
    <figure className="min-w-0">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-navy-800">{title}</span>
        <span className="text-2xs text-ink-subtle">{values.length === 0 ? "Not reported" : `${values.length} of ${data.length} reported`}</span>
      </figcaption>
      {values.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed border-line-strong px-3 py-8 text-center text-2xs text-ink-subtle">{emptyText}</p>
      ) : (
        <div className="relative mt-2">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full touch-none select-none focus-visible:outline-2 focus-visible:outline-brand-red"
            role="img"
            aria-label={`${title}. Use left and right arrow keys to read each bar.`}
            aria-describedby={`${id}-readout`}
            tabIndex={0}
            onPointerMove={onPointer}
            onPointerLeave={() => setActive(null)}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
          >
            {[0, max / 2, max].map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
                <text x={pad.left - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--color-ink-subtle)">
                  {COUNT.format(Math.round(t))}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              if (d.value === null) return null;
              const top = y(d.value);
              const h = Math.max(0, pad.top + innerH - top);
              const x = pad.left + i * slot + (slot - barW) / 2;
              const r = Math.min(4, barW / 2, h);
              // Rounded at the data end only, square on the baseline.
              const path = `M${x},${top + h} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${top + h} Z`;
              return <path key={d.key} d={path} fill={active === i ? "var(--color-navy-700)" : MARK} />;
            })}
            {labelAt.map((i) => (
              <text key={i} x={pad.left + i * slot + slot / 2} y={height - 6} textAnchor={i === 0 && data.length > 1 ? "start" : i === data.length - 1 && data.length > 1 ? "end" : "middle"} fontSize={10} fill="var(--color-ink-subtle)">
                {data[i]!.label}
              </text>
            ))}
          </svg>
          <div
            id={`${id}-readout`}
            aria-live="polite"
            className={`pointer-events-none absolute top-0 rounded-md border border-line bg-white px-2 py-1 text-2xs shadow-sm ${point ? "" : "sr-only"}`}
            style={point && active !== null ? { left: `${Math.min(80, Math.max(0, ((pad.left + active * slot) / width) * 100 - 8))}%` } : undefined}
          >
            {point ? (
              <>
                <span className="block text-sm font-semibold tabular-nums text-navy-800">{show(point)}</span>
                <span className="text-ink-subtle">
                  {point.label}
                  {point.note ? ` · ${point.note}` : ""}
                </span>
              </>
            ) : null}
          </div>
        </div>
      )}
      {values.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-2xs text-ink-subtle">Table view</summary>
          <table className="mt-1 w-full text-2xs">
            <thead>
              <tr className="text-left text-ink-subtle">
                <th className="py-0.5 font-medium">Period</th>
                <th className="py-0.5 text-right font-medium">{title}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.key} className="border-t border-line">
                  <td className="py-0.5">
                    {d.label}
                    {d.note ? <span className="text-ink-subtle"> · {d.note}</span> : null}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">{show(d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </figure>
  );
}
