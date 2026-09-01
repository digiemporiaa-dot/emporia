"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Site header with mobile navigation.
 *
 * The mobile panel is a real dialog: focus moves into it, Esc closes it, focus
 * returns to the trigger, and background scroll is locked (CLAUDE.md 12).
 */

const LINKS: readonly { href: Route; label: string }[] = [
  { href: "/services", label: "Services" },
  { href: "/packages", label: "Packages" },
  { href: "/case-studies", label: "Work" },
  { href: "/blog", label: "Insights" },
  { href: "/about", label: "About" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // Close on route change, so tapping a link does not leave the panel open.
  React.useEffect(() => {
    setOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>("a[href], button");
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const isActive = (href: Route) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-(--container-page) items-center justify-between gap-6 px-5 lg:px-8">
        <Link
          href="/"
          className="font-display text-lg font-semibold tracking-tightest text-navy-800"
        >
          Emporia
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-7">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={cn(
                    "relative py-2 text-sm transition-colors duration-(--duration-fast)",
                    isActive(link.href)
                      ? "text-navy-800"
                      : "text-ink-muted hover:text-navy-800",
                  )}
                >
                  {link.label}
                  {isActive(link.href) ? (
                    <span className="absolute inset-x-0 -bottom-px h-px bg-brand-red" />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/contact"
            className="hidden h-9.5 items-center rounded-md bg-brand-red px-4 text-sm font-medium text-white transition-colors duration-(--duration-fast) hover:bg-red-600 lg:inline-flex"
          >
            Start a project
          </Link>

          <button
            ref={triggerRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-haspopup="dialog"
            className="inline-flex h-9.5 w-9.5 items-center justify-center rounded-md border border-line-strong text-navy-800 lg:hidden"
          >
            <Menu size={18} aria-hidden="true" />
            <span className="sr-only">Open menu</span>
          </button>
        </div>
      </div>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          className="fixed inset-0 z-50 flex flex-col bg-navy-800 lg:hidden"
        >
          <div className="flex h-16 items-center justify-between px-5">
            <span className="font-display text-lg font-semibold tracking-tightest text-white">
              Emporia
            </span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="inline-flex h-9.5 w-9.5 items-center justify-center rounded-md border border-navy-700 text-white"
            >
              <X size={18} aria-hidden="true" />
              <span className="sr-only">Close menu</span>
            </button>
          </div>

          <nav aria-label="Site" className="flex-1 overflow-y-auto px-5 pt-6">
            <ul className="space-y-1">
              {LINKS.map((link, index) => (
                <li key={link.href} className="border-b border-navy-700/70">
                  <Link
                    href={link.href}
                    className="flex items-baseline gap-4 py-4 font-display text-2xl text-white"
                  >
                    <span className="text-2xs tabular-nums tracking-widest text-navy-300">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="px-5 pb-8 pt-4">
            <Link
              href="/contact"
              className="flex h-12 items-center justify-center rounded-md bg-brand-red px-5 text-base font-medium text-white"
            >
              Start a project
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
