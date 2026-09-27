import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, CalendarClock, ExternalLink, Image as ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui";
import { CONTENT_STAGE_LABEL, CONTENT_STAGE_TONE } from "@/lib/projects/lifecycle";
import {
  POST_STATUS_LABEL,
  POST_TYPE_LABEL,
  PROVIDER_LABEL,
  PROVIDER_SHORT,
} from "@/lib/social/capabilities";
import type { CalendarCard as Card } from "@/lib/services/social-calendar.service";

/**
 * One scheduled platform version.
 *
 * The brief's card reads "Instagram / Diwali Campaign / Client Review / 05 Oct
 * 7:30 PM / creative" and that is the order here, because it is the order a
 * planner scans in: what platform, what campaign, whose desk is it on, when,
 * and what does it look like.
 *
 * Two densities. In a month cell there is room for one line, so the card
 * collapses to platform, time and title; in the week, day and list views it
 * opens out. Same component, because the same card in two sizes is easier to
 * trust than two components that drift apart.
 */

export type CardDensity = "compact" | "full";

/** Platforms are told apart by name, not colour — the palette is navy and red. */
function providerMark(card: Card) {
  return (
    <span className="shrink-0 rounded-sm bg-navy-800 px-1 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide text-white">
      {PROVIDER_LABEL[card.provider]}
    </span>
  );
}

export function CalendarCard({
  card,
  density,
  base,
  timeFormat,
}: {
  card: Card;
  density: CardDensity;
  base: string;
  timeFormat: Intl.DateTimeFormat;
}) {
  const href = `${base}/content/${card.itemId}` as Route;
  const at = card.effectiveAt ? timeFormat.format(new Date(card.effectiveAt)) : null;

  if (density === "compact") {
    return (
      <Link
        href={href}
        title={`${PROVIDER_LABEL[card.provider]} · ${card.title}${at ? ` · ${at}` : ""}`}
        className="group flex items-center gap-1 rounded-sm border border-line bg-white px-1 py-0.5 hover:border-navy-800"
      >
        {card.failed ? (
          <AlertTriangle size={10} className="shrink-0 text-brand-red" aria-label="Failed" />
        ) : null}
        {/* Two versions of one idea land on the same day at the same time more
            often than not, so the platform has to be on the card — without it
            they are two identical rows. */}
        <span className="shrink-0 rounded-sm bg-navy-800 px-1 text-[9px] font-semibold uppercase leading-4 tracking-wide text-white">
          {PROVIDER_SHORT[card.provider]}
        </span>
        {at ? (
          <span className="shrink-0 text-[10px] tabular-nums leading-4 text-ink-subtle">{at}</span>
        ) : null}
        <span className="truncate text-[11px] leading-4 text-navy-800">{card.title}</span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="block rounded-md border border-line bg-white p-2 transition-colors hover:border-navy-800"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {providerMark(card)}
        <span className="text-2xs text-ink-subtle">{POST_TYPE_LABEL[card.type]}</span>
        {card.campaign ? (
          <span className="truncate text-2xs text-ink-subtle">· {card.campaign.name}</span>
        ) : null}
      </div>

      <div className="mt-1.5 flex gap-2">
        {card.thumbnail ? (
          // Media is on R2 behind a public URL that next/image is not configured
          // for, and a calendar thumbnail is a 40px decoration, so a plain img
          // is the honest choice here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.thumbnail.url}
            alt={card.thumbnail.alt ?? ""}
            loading="lazy"
            className="h-10 w-10 shrink-0 rounded-sm border border-line object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-dashed border-line-strong text-ink-subtle"
          >
            <ImageIcon size={14} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-navy-800">{card.title}</p>
          {card.excerpt ? (
            <p className="mt-0.5 line-clamp-2 text-2xs text-ink-subtle">{card.excerpt}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone={CONTENT_STAGE_TONE[card.stage]}>{CONTENT_STAGE_LABEL[card.stage]}</Badge>
        {at ? (
          <span className="inline-flex items-center gap-1 text-2xs tabular-nums text-ink-subtle">
            <CalendarClock size={11} aria-hidden="true" />
            {at}
            {card.inherited ? (
              <span title="Taken from the idea's target date — this version has no time of its own.">
                · from idea
              </span>
            ) : null}
          </span>
        ) : null}
        {card.failed ? (
          <span className="inline-flex items-center gap-1 text-2xs font-medium text-brand-red-text">
            <AlertTriangle size={11} aria-hidden="true" />
            {POST_STATUS_LABEL.FAILED}
          </span>
        ) : null}
        {card.externalUrl ? (
          <span className="inline-flex items-center gap-1 text-2xs text-ink-subtle">
            <ExternalLink size={11} aria-hidden="true" />
            Live
          </span>
        ) : null}
      </div>
    </Link>
  );
}
