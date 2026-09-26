/**
 * List skeleton, shared by every filtered admin list.
 *
 * Rendered through an explicit <Suspense> inside each list page rather than a
 * `loading.tsx`. A loading boundary at the segment level also wraps that
 * segment's *children*, and Next streams the shell before the child runs — so
 * `notFound()` in a detail route below answered a dead URL with 200 and a
 * skeleton instead of a 404. That is the trap docs/ARCHITECTURE.md 17.2 records
 * for the public routes; it applies here for the same reason, which is why
 * this project has no `loading.tsx` anywhere and this component instead.
 *
 * The point is not the shimmer. It is that the filter bar above stays mounted
 * and interactive while the query runs, so changing a filter twice in a row
 * does not mean waiting for the first result.
 */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      className="animate-pulse space-y-px rounded-lg border border-line bg-white p-3"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-11 rounded-sm bg-surface-sunken/70" />
      ))}
    </div>
  );
}
