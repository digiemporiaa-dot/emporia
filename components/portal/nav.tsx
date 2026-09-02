"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarRange,
  CheckCircle2,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  Paperclip,
  Receipt,
  UserRound,
} from "lucide-react";
import type { Route } from "next";
import { cn } from "@/lib/utils/cn";

/**
 * Portal navigation.
 *
 * Deliberately calmer than the admin sidebar: a client visits occasionally and
 * needs to find one thing, so the sections are few and named in their language,
 * not the agency's.
 */

const ICONS = {
  dashboard: LayoutDashboard,
  projects: FolderKanban,
  content: CalendarRange,
  approvals: CheckCircle2,
  documents: FileText,
  invoices: Receipt,
  campaigns: Megaphone,
  files: Paperclip,
  messages: MessageSquare,
  profile: UserRound,
} as const;

export type PortalNavItem = {
  href: Route;
  label: string;
  icon: keyof typeof ICONS;
  badge?: number;
};

export function PortalNav({ items }: { items: readonly PortalNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Portal sections">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active =
            pathname === item.href ||
            (item.href !== "/portal" && pathname.startsWith(`${item.href}/`));

          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-(--duration-instant)",
                  active
                    ? "bg-navy-800 text-white"
                    : "text-navy-700 hover:bg-navy-50 hover:text-navy-800",
                )}
              >
                <Icon size={16} aria-hidden="true" className={active ? "text-brand-red" : ""} />
                <span>{item.label}</span>
                {item.badge ? (
                  <span
                    className={cn(
                      "ml-auto rounded-full px-1.5 py-px text-2xs font-semibold tabular-nums",
                      active ? "bg-brand-red text-white" : "bg-brand-red/10 text-brand-red",
                    )}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
