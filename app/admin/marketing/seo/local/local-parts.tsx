import type { ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { CellStatus } from "@/lib/seo-intel/engine/local";

/** Pieces shared by the Local SEO screens. */

const SECTIONS = [
  { key: "coverage", label: "Coverage", href: "/admin/marketing/seo/local" },
  { key: "reviews", label: "Google reviews", href: "/admin/marketing/seo/local/reviews" },
  { key: "nap", label: "Name, address, phone", href: "/admin/marketing/seo/local/nap" },
  { key: "setup", label: "Services and cities", href: "/admin/marketing/seo/local/setup" },
] as const;

export function LocalNav({ current, propertyId }: { current: (typeof SECTIONS)[number]["key"]; propertyId: string }) {
  return (
    <nav aria-label="Local SEO" className="mb-5 flex flex-wrap gap-1">
      {SECTIONS.map((section) => (
        <Link
          key={section.key}
          href={`${section.href}?property=${propertyId}` as Route}
          aria-current={section.key === current ? "page" : undefined}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs",
            section.key === current ? "bg-navy-800 font-medium text-white" : "border border-line bg-white text-ink-muted hover:text-navy-800",
          )}
        >
          {section.label}
        </Link>
      ))}
    </nav>
  );
}

export const CELL_LABEL: Record<CellStatus, string> = {
  covered: "Covered",
  gap: "No page",
  "not-indexable": "Not indexable",
  "not-crawled": "Not crawled",
  draft: "CMS draft",
};
const CELL_TONE = { covered: "success", gap: "red", "not-indexable": "warning", "not-crawled": "neutral", draft: "navy" } as const;

export function CellBadge({ status }: { status: CellStatus }) {
  return <Badge tone={CELL_TONE[status]}>{CELL_LABEL[status]}</Badge>;
}

export const HOW_LABEL = { url: "matched by URL", title: "matched by title or H1", mixed: "matched by URL and title together", chosen: "chosen by staff", cms: "the CMS page" } as const;

export const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function Notice({ children }: { children: ReactNode }) {
  return <p role="status" className="mb-4 rounded-md border border-line bg-white px-3.5 py-2.5 text-xs text-ink-muted">{children}</p>;
}
