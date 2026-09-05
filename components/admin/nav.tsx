"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarRange,
  CheckCircle2,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  LayoutDashboard,
  Megaphone,
  Receipt,
  Settings,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import type { Route } from "next";
import { cn } from "@/lib/utils/cn";

/**
 * Admin navigation.
 *
 * Items are filtered by permission on the server before they reach this
 * component. That is a usability filter, not a security control — every route
 * behind these links re-checks authorization for itself (CLAUDE.md 2 rule 2).
 */

/**
 * A section is either live or not yet built. Modelling that in the type keeps
 * `typedRoutes` honest — a link can only point at a route that exists — while
 * still showing the shape of the product. A pending item is inert, not a link
 * to a stub page.
 */
export type NavItem =
  | { kind: "link"; href: Route; label: string; icon: keyof typeof ICONS }
  | { kind: "pending"; label: string; icon: keyof typeof ICONS; phase?: number };

const ICONS = {
  dashboard: LayoutDashboard,
  leads: Users,
  sales: FileText,
  clients: Building2,
  projects: FolderKanban,
  content: CalendarRange,
  approvals: CheckCircle2,
  marketing: Megaphone,
  finance: Receipt,
  media: ImageIcon,
  analytics: BarChart3,
  automation: Workflow,
  ai: Sparkles,
  settings: Settings,
} as const;

export function AdminNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin sections" className="px-2 py-3">
      <ul className="space-y-0.5">
        {items.map((item) => {
          const Icon = ICONS[item.icon];

          if (item.kind === "pending") {
            return (
              <li key={item.label}>
                <span
                  aria-disabled="true"
                  title={item.phase ? `Built in phase ${item.phase}` : "Not built yet"}
                  className="flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-navy-300/70"
                >
                  <Icon size={16} aria-hidden="true" />
                  {item.label}
                  {item.phase ? (
                    <span className="ml-auto text-2xs uppercase tracking-widest text-navy-500">
                      P{item.phase}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          }

          const active =
            pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`));

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-(--duration-instant)",
                  active
                    ? "bg-navy-700 text-white"
                    : "text-navy-100 hover:bg-navy-700/60 hover:text-white",
                )}
              >
                <Icon size={16} aria-hidden="true" className={active ? "text-brand-red" : ""} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
