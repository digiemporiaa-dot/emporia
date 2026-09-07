/**
 * Skeleton for the pages list. The admin is a data-dense surface; a blank
 * screen while the query runs reads as broken (CLAUDE.md 12).
 */
export default function Loading() {
  return (
    <div className="animate-pulse">
      <div className="mb-5 h-14 w-56 rounded-md bg-surface-sunken" />
      <div className="h-14 rounded-lg bg-surface-sunken" />
      <div className="mt-4 space-y-px rounded-lg border border-line bg-white p-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-11 rounded-sm bg-surface-sunken/70" />
        ))}
      </div>
    </div>
  );
}
