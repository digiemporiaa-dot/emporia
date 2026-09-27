"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

/**
 * Tabs across the client's social section.
 *
 * Only the sections that exist are listed. A tab leading to an empty screen
 * is a promise the product has not kept yet, so the later phases add their own
 * tab when they add their own page.
 */
const TABS = [
  { segment: "calendar", label: "Calendar" },
  { segment: "content", label: "Content" },
  { segment: "accounts", label: "Accounts" },
] as const;

export function SocialNav({ clientId }: { clientId: string }) {
  const pathname = usePathname();
  const base = `/admin/clients/${clientId}/social`;

  return (
    <nav aria-label="Social media sections" className="border-b border-line">
      <ul className="-mb-px flex flex-wrap gap-1">
        {TABS.map((tab) => {
          const href = `${base}/${tab.segment}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={tab.segment}>
              <Link
                href={href as Route}
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
