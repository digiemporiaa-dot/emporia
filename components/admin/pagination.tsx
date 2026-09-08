import Link from "next/link";
import type { Route } from "next";

/**
 * List pagination.
 *
 * A server component: the links are real hrefs, so a paged view is shareable
 * and works without JavaScript. Existing query parameters are carried through,
 * so paging never silently drops a filter.
 */
export function Pagination({
  basePath,
  params,
  page,
  pages,
  total,
  perPage,
}: {
  basePath: string;
  params: Record<string, unknown>;
  page: number;
  pages: number;
  total: number;
  perPage: number;
}) {
  if (total === 0) return null;

  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);

  const href = (target: number): Route => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "" && key !== "page") {
        query.set(key, String(value));
      }
    }
    query.set("page", String(target));
    return `${basePath}?${query.toString()}` as Route;
  };

  return (
    <nav
      aria-label="Pagination"
      className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-subtle"
    >
      <p>
        Showing {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        {page <= 1 ? (
          <span aria-disabled="true" className="rounded-sm border border-line px-2.5 py-1 text-ink-subtle">
            Previous
          </span>
        ) : (
          <Link
            href={href(page - 1)}
            className="rounded-sm border border-line-strong px-2.5 py-1 text-navy-800 hover:border-brand-red hover:text-brand-red-text"
          >
            Previous
          </Link>
        )}

        <span className="tabular-nums">
          Page {page} of {pages}
        </span>

        {page >= pages ? (
          <span aria-disabled="true" className="rounded-sm border border-line px-2.5 py-1 text-ink-subtle">
            Next
          </span>
        ) : (
          <Link
            href={href(page + 1)}
            className="rounded-sm border border-line-strong px-2.5 py-1 text-navy-800 hover:border-brand-red hover:text-brand-red-text"
          >
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}
