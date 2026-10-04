import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { cn } from "@/lib/utils/cn";

/**
 * The SEO Intelligence header and section tabs.
 *
 * Only sections that exist are listed. A tab for something not built yet
 * would be a page of placeholders, and this product does not show those
 * (CLAUDE.md 2 rule 5) — each phase adds its tab when it lands.
 */

const TABS: readonly { href: Route; label: string; key: string; connectOnly?: boolean }[] = [
  { href: "/admin/marketing/seo", label: "Overview", key: "overview" },
  { href: "/admin/marketing/seo/performance", label: "Search performance", key: "performance" },
  { href: "/admin/marketing/seo/keywords", label: "Keywords", key: "keywords" },
  { href: "/admin/marketing/seo/opportunities", label: "Opportunities", key: "opportunities" },
  { href: "/admin/marketing/seo/crawl", label: "Site crawl", key: "crawl" },
  { href: "/admin/marketing/seo/technical", label: "Technical SEO", key: "technical" },
  { href: "/admin/marketing/seo/indexation", label: "Indexation", key: "indexation" },
  { href: "/admin/marketing/seo/properties", label: "Websites", key: "properties" },
  { href: "/admin/marketing/seo/settings", label: "Settings", key: "settings", connectOnly: true },
];

export function SeoHeader({
  current,
  title,
  description,
  crumbs = [],
  query = "",
  canConnect = false,
}: {
  current: string;
  title: string;
  description?: string;
  crumbs?: readonly { href?: Route; label: string }[];
  /** Carried across tabs, e.g. `?property=…`. */
  query?: string;
  /** Shows the Settings tab (Google credentials), which needs `seo.intelligence.connect`. */
  canConnect?: boolean;
}) {
  return (
    <header className="mb-6">
      <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
        <Link href="/admin/marketing" className="hover:text-navy-800">
          Marketing
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href="/admin/marketing/seo" className="hover:text-navy-800">
          SEO Intelligence
        </Link>
        {crumbs.map((crumb) => (
          <React.Fragment key={crumb.label}>
            <span aria-hidden="true"> / </span>
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-navy-800">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-navy-700">{crumb.label}</span>
            )}
          </React.Fragment>
        ))}
      </nav>
      <h1 className="mt-1.5 text-2xl text-navy-800">{title}</h1>
      {description ? <p className="mt-1.5 max-w-3xl text-xs text-ink-subtle">{description}</p> : null}
      <nav aria-label="SEO Intelligence sections" className="mt-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.filter((tab) => !tab.connectOnly || canConnect).map((tab) => (
          <Link
            key={tab.key}
            href={`${tab.href}${tab.connectOnly ? "" : query}` as Route}
            aria-current={tab.key === current ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm",
              tab.key === current
                ? "border-brand-red font-medium text-navy-800"
                : "border-transparent text-ink-muted hover:text-navy-800",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
