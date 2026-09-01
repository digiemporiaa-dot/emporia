import Link from "next/link";
import type { Route } from "next";
import { JsonLd } from "@/components/website/json-ld";
import { breadcrumbSchema, type Crumb } from "@/lib/seo/breadcrumbs";

/**
 * Visible breadcrumb plus its BreadcrumbList schema, from one list — so the
 * markup and the structured data cannot disagree.
 *
 * The last crumb is the current page and is not a link.
 */
export function Breadcrumbs({ crumbs, tone = "dark" }: { crumbs: readonly Crumb[]; tone?: "dark" | "light" }) {
  if (crumbs.length < 2) return null;

  const linkClass = tone === "light" ? "text-navy-300 hover:text-white" : "text-ink-subtle hover:text-navy-800";
  const currentClass = tone === "light" ? "text-navy-100" : "text-navy-700";

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-xs">
        <ol className="flex flex-wrap items-center gap-1.5">
          {crumbs.map((crumb, index) => {
            const isLast = index === crumbs.length - 1;
            return (
              <li key={crumb.path} className="flex items-center gap-1.5">
                {isLast ? (
                  <span aria-current="page" className={currentClass}>
                    {crumb.name}
                  </span>
                ) : (
                  <>
                    <Link href={crumb.path as Route} className={linkClass}>
                      {crumb.name}
                    </Link>
                    <span aria-hidden="true" className={linkClass}>
                      /
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <JsonLd schema={breadcrumbSchema(crumbs)} />
    </>
  );
}
