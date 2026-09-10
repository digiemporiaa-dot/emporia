"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarRange,
  CheckCircle2,
  ChevronRight,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  Blocks,
  Layers,
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
 * component — sub-items individually, not by their parent. That is a usability
 * filter, not a security control: every route behind these links re-checks
 * authorization for itself (CLAUDE.md 2 rule 2).
 *
 * ## Why the sub-items are here at all
 *
 * A module like Website holds seven screens, and until now the only way between
 * them was through the hub: two clicks and a page load to get from Blog to Case
 * studies. The hub cards stay — they carry counts and a sentence about each
 * section, which a sidebar cannot — but the sidebar now offers the direct route.
 *
 * ## Expansion, and what happens before hydration
 *
 * The group containing the current page is open on first render, derived from
 * the pathname rather than from state, so the server sends it open and it is
 * open in the HTML. Every sub-item is a real link. The disclosure buttons only
 * become useful once this component is interactive, which is the right way
 * round: a person who lands on Blog can see and reach its siblings immediately,
 * with or without JavaScript.
 */

export type NavChild = { href: Route; label: string };

export type NavItem =
  | {
      kind: "link";
      href: Route;
      label: string;
      icon: keyof typeof ICONS;
      children?: readonly NavChild[];
    }
  | { kind: "pending"; label: string; icon: keyof typeof ICONS; phase?: number };

const ICONS = {
  dashboard: LayoutDashboard,
  leads: Users,
  sales: FileText,
  clients: Building2,
  projects: FolderKanban,
  content: CalendarRange,
  pages: Layers,
  sections: Blocks,
  approvals: CheckCircle2,
  marketing: Megaphone,
  finance: Receipt,
  media: ImageIcon,
  analytics: BarChart3,
  automation: Workflow,
  ai: Sparkles,
  settings: Settings,
} as const;

/** Is this path the current page, or an ancestor of it? */
function within(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function GroupLinks({
  links,
  pathname,
}: {
  links: readonly NavChild[];
  pathname: string;
}) {
  return (
    <ul className="mt-0.5 space-y-px border-l border-navy-700 pl-2.5 ml-4">
      {links.map((child) => {
        const active = within(pathname, child.href);
        return (
          <li key={child.href}>
            <Link
              href={child.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "block rounded-md px-2.5 py-1.5 text-xs transition-colors duration-(--duration-instant)",
                active
                  ? "bg-navy-700 font-medium text-white"
                  // navy-300, not an invented navy-200: the ramp has no 200,
                  // and an undefined token generates no colour at all. This
                  // measures 5.56:1 on navy-800, clearing AA while staying
                  // quieter than the module above it (CLAUDE.md 12).
                  : "text-navy-300 hover:bg-navy-700/50 hover:text-white",
              )}
            >
              {child.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AdminNav({ items }: { items: readonly NavItem[] }) {
  const pathname = usePathname();

  /**
   * Which groups the reader has opened by hand.
   *
   * Only ever *adds* to what the pathname already opens: closing the group you
   * are standing in would hide the page you are on from its own navigation.
   */
  const [opened, setOpened] = React.useState<ReadonlySet<string>>(() => new Set());

  const toggle = (href: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });

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

          // The dashboard is at /admin, which is a prefix of everything; only an
          // exact match makes it the current page.
          const here = item.href === "/admin" ? pathname === "/admin" : within(pathname, item.href);
          const children = item.children ?? [];
          const hasChildren = children.length > 0;
          const expanded = hasChildren && (here || opened.has(item.href));
          const listId = `nav-${item.href.replace(/\W+/g, "-")}`;

          return (
            <li key={item.href}>
              <div className="flex items-center">
                <Link
                  href={item.href}
                  aria-current={pathname === item.href ? "page" : undefined}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors duration-(--duration-instant)",
                    here
                      ? "bg-navy-700 text-white"
                      : "text-navy-100 hover:bg-navy-700/60 hover:text-white",
                  )}
                >
                  <Icon size={16} aria-hidden="true" className={here ? "text-brand-red" : ""} />
                  <span className="truncate">{item.label}</span>
                </Link>

                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggle(item.href)}
                    aria-expanded={expanded}
                    aria-controls={listId}
                    className="ml-0.5 shrink-0 rounded-md p-1.5 text-navy-300 hover:bg-navy-700/60 hover:text-white"
                  >
                    <ChevronRight
                      size={14}
                      aria-hidden="true"
                      className={cn(
                        "transition-transform duration-(--duration-instant)",
                        expanded ? "rotate-90" : "",
                      )}
                    />
                    <span className="sr-only">
                      {expanded ? `Hide ${item.label} sections` : `Show ${item.label} sections`}
                    </span>
                  </button>
                ) : null}
              </div>

              {hasChildren ? (
                <div id={listId} hidden={!expanded}>
                  <GroupLinks links={children} pathname={pathname} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
