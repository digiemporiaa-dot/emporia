import { z } from "zod";

/**
 * Responsive grid configuration for card-based blocks.
 *
 * Column counts are stored as data and turned into a *fixed* Tailwind class by
 * the maps below. They are never interpolated — `lg:grid-cols-${n}` produces a
 * class Tailwind's scanner cannot see, so the CSS is never generated and the
 * grid silently collapses to one column in production while looking correct in
 * development. Every class an editor can reach is written out literally here.
 *
 * The layout is CSS Grid: no JavaScript measures anything, and a page renders
 * at the right width in the first paint rather than after hydration.
 */

export const gapToken = z.enum(["xs", "sm", "md", "lg", "xl"]);
export type GapToken = z.infer<typeof gapToken>;

export const desktopColumns = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
export const tabletColumns = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const mobileColumns = z.union([z.literal(1), z.literal(2)]);

export const gridConfig = z.object({
  desktop: desktopColumns.default(3),
  tablet: tabletColumns.default(2),
  mobile: mobileColumns.default(1),
  gap: gapToken.default("md"),
  /** Optional overrides. Absent means "use `gap` for both axes". */
  rowGap: gapToken.optional(),
  columnGap: gapToken.optional(),
});

export type GridConfig = z.infer<typeof gridConfig>;

const MOBILE: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
};

const TABLET: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
};

const DESKTOP: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

const ROW_GAP: Record<GapToken, string> = {
  xs: "gap-y-2",
  sm: "gap-y-3",
  md: "gap-y-5",
  lg: "gap-y-8",
  xl: "gap-y-12",
};

const COLUMN_GAP: Record<GapToken, string> = {
  xs: "gap-x-2",
  sm: "gap-x-3",
  md: "gap-x-5",
  lg: "gap-x-8",
  xl: "gap-x-12",
};

export const GAP_LABELS: Record<GapToken, string> = {
  xs: "Extra small",
  sm: "Small",
  md: "Medium",
  lg: "Large",
  xl: "Extra large",
};

/**
 * The effective grid for a block.
 *
 * `columns` is the pre-grid field the card blocks shipped with. A row saved
 * before this existed has no `grid`, so its stored column count is honoured and
 * the rest takes sensible defaults — the page keeps rendering exactly as it
 * did, and gains the new controls the first time someone opens it.
 */
export function resolveGrid(value: unknown): GridConfig {
  const record = (value ?? {}) as Record<string, unknown>;
  const stored = record["grid"];
  if (stored && typeof stored === "object") {
    const parsed = gridConfig.safeParse(stored);
    if (parsed.success) return parsed.data;
  }

  const legacy = record["columns"];
  const desktop = desktopColumns.safeParse(legacy);
  return gridConfig.parse({ desktop: desktop.success ? desktop.data : 3 });
}

/** The class list for a grid container. Every entry is a literal Tailwind class. */
export function gridClasses(grid: GridConfig): string {
  const rows = ROW_GAP[grid.rowGap ?? grid.gap];
  const columns = COLUMN_GAP[grid.columnGap ?? grid.gap];
  return [
    "grid",
    MOBILE[grid.mobile] ?? MOBILE[1],
    TABLET[grid.tablet] ?? TABLET[2],
    DESKTOP[grid.desktop] ?? DESKTOP[3],
    rows,
    columns,
  ]
    .filter(Boolean)
    .join(" ");
}
