"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

/** The portal's social sections (brief §16). */
const TABS = [
  { href: "/portal/social", label: "Overview", exact: true },
  { href: "/portal/social/calendar", label: "Calendar" },
  { href: "/portal/social/approvals", label: "Approvals" },
  { href: "/portal/social/published", label: "Published" },
  { href: "/portal/social/analytics", label: "Analytics" },
  { href: "/portal/social/reports", label: "Reports" },
] as const;

export function PortalSocialTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Social sections" className="border-b border-line">
      <ul className="-mb-px flex flex-wrap gap-1">
        {TABS.map((tab) => {
          const active = "exact" in tab ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href as Route}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "inline-flex h-9 items-center border-b-2 border-brand-red px-3 text-sm font-medium text-navy-800"
                    : "inline-flex h-9 items-center border-b-2 border-transparent px-3 text-sm text-ink-muted hover:border-line-strong hover:text-navy-800"
                }
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
