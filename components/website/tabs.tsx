"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Tabs, built to the WAI-ARIA tabs pattern.
 *
 * Arrow keys move between tabs, Home and End jump to the ends, and only the
 * active tab is in the tab order — which is the part hand-rolled tab strips
 * usually miss, leaving a keyboard user to tab through twelve labels to reach
 * the panel (CLAUDE.md 12).
 *
 * Every panel's content is in the markup; the inactive ones are hidden rather
 * than unmounted, so the text is in the page for anything that reads it without
 * running JavaScript.
 */

export function Tabs({ items }: { items: readonly { label: string; body: string }[] }) {
  const [active, setActive] = React.useState(0);
  const id = React.useId();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const focus = (index: number) => {
    const next = (index + items.length) % items.length;
    setActive(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") focus(active + 1);
    else if (event.key === "ArrowLeft") focus(active - 1);
    else if (event.key === "Home") focus(0);
    else if (event.key === "End") focus(items.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Sections"
        onKeyDown={onKeyDown}
        className="flex flex-wrap gap-1 border-b border-line"
      >
        {items.map((item, index) => (
          <button
            key={`${index}-${item.label}`}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-selected={active === index}
            aria-controls={`${id}-panel-${index}`}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors",
              active === index
                ? "border-brand-red text-navy-800"
                : "border-transparent text-ink-muted hover:text-navy-800",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {items.map((item, index) => (
        <div
          key={`${index}-${item.label}`}
          role="tabpanel"
          id={`${id}-panel-${index}`}
          aria-labelledby={`${id}-tab-${index}`}
          hidden={active !== index}
          tabIndex={0}
          className="pt-5 text-ink-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red"
        >
          {item.body.split(/\n{2,}/).map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex} className="mt-3 first:mt-0">
              {paragraph}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
