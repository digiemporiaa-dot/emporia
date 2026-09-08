"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { NavLink, isExternalHref } from "@/components/website/nav-link";
import type { NavItemInput } from "@/lib/validation/navigation";

/**
 * Site header with mobile navigation.
 *
 * The mobile panel is a real dialog: focus moves into it, Esc closes it, focus
 * returns to the trigger, and background scroll is locked (CLAUDE.md 12).
 *
 * The links and the call to action are props rather than a constant — they are
 * edited in Settings → Navigation. This component still owns every decision
 * about how they look and behave.
 */

export type HeaderCta = { label: string; href: string };

export function SiteHeaderNav({
  brandName,
  links,
  cta,
}: {
  brandName: string;
  links: readonly NavItemInput[];
  cta: HeaderCta | null;
}) {
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

  // A link that leaves the site is never the current page, however the path
  // happens to compare.
  const isActive = (href: string) =>
    !isExternalHref(href) &&
    !href.startsWith("#") &&
    (pathname === href || pathname.startsWith(`${href}/`));

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-(--container-page) items-center justify-between gap-6 px-5 lg:px-8">
        <Link
          href="/"
          className="font-display text-lg font-semibold tracking-tightest text-navy-800"
        >
          {brandName}
        </Link>

        {links.length > 0 ? (
          <nav aria-label="Main" className="hidden lg:block">
            <ul className="flex items-center gap-7">
              {links.map((link) => (
                <li key={`${link.href}-${link.label}`}>
                  <NavLink
                    href={link.href}
                    newTab={link.newTab}
                    aria-current={isActive(link.href) ? "page" : undefined}
                    className={cn(
                      "relative py-2 text-sm transition-colors duration-(--duration-fast)",
                      isActive(link.href) ? "text-navy-800" : "text-ink-muted hover:text-navy-800",
                    )}
                  >
                    {link.label}
                    {isActive(link.href) ? (
                      <span className="absolute inset-x-0 -bottom-px h-px bg-brand-red" />
                    ) : null}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div className="flex items-center gap-2">
          {cta ? (
            <NavLink
              href={cta.href}
              className="hidden h-9.5 items-center rounded-md bg-brand-red px-4 text-sm font-medium text-white transition-colors duration-(--duration-fast) hover:bg-red-600 lg:inline-flex"
            >
              {cta.label}
            </NavLink>
          ) : null}

          {links.length > 0 || cta ? (
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
          ) : null}
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
              {brandName}
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
              {links.map((link, index) => (
                <li key={`${link.href}-${link.label}`} className="border-b border-navy-700/70">
                  <NavLink
                    href={link.href}
                    newTab={link.newTab}
                    className="flex items-baseline gap-4 py-4 font-display text-2xl text-white"
                  >
                    <span className="text-2xs tabular-nums tracking-widest text-navy-300">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>

          {cta ? (
            <div className="px-5 pb-8 pt-4">
              <NavLink
                href={cta.href}
                className="flex h-12 items-center justify-center rounded-md bg-brand-red px-5 text-base font-medium text-white"
              >
                {cta.label}
              </NavLink>
            </div>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
