import Link from "next/link";
import type { Route } from "next";
import { Monitor, Smartphone, Tablet, UserRound } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { PreviewVisitorInput } from "@/lib/validation/audience";

/**
 * Preview as somebody.
 *
 * Links rather than a form, so the choice lives in the URL: an editor can
 * bookmark "this page as a returning mobile visitor from the autumn campaign"
 * and send it to someone. It also means the picker needs no JavaScript, and the
 * server does the filtering — the same matcher the live page uses.
 *
 * The attributes offered are the ones the server genuinely knows. There is no
 * location, because there is no geo-IP: a "preview as a Gurgaon visitor" button
 * would promise an audience the application cannot identify.
 */

/** The current choice as a query string, for the preview iframe's src. */
export function visitorQuery(visitor: PreviewVisitorInput): string {
  const params = new URLSearchParams();
  params.set("device", visitor.device);
  params.set("visitor", visitor.visitor);
  if (visitor.utmSource) params.set("utmSource", visitor.utmSource);
  if (visitor.utmMedium) params.set("utmMedium", visitor.utmMedium);
  if (visitor.utmCampaign) params.set("utmCampaign", visitor.utmCampaign);
  if (visitor.referrer) params.set("referrer", visitor.referrer);
  return params.toString();
}

function href(pageId: string, visitor: PreviewVisitorInput, patch: Partial<PreviewVisitorInput>) {
  const next = { ...visitor, ...patch };
  return `/admin/website/pages/${pageId}/preview?${visitorQuery(next)}` as Route;
}

const DEVICES = [
  { id: "DESKTOP", label: "Desktop", Icon: Monitor },
  { id: "TABLET", label: "Tablet", Icon: Tablet },
  { id: "MOBILE", label: "Phone", Icon: Smartphone },
] as const;

const VISITORS = [
  { id: "NEW", label: "First time" },
  { id: "RETURNING", label: "Returning" },
] as const;

function Chip({
  active,
  to,
  children,
}: {
  active: boolean;
  to: Route;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={to}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors",
        active
          ? "bg-navy-800 text-white"
          : "text-ink-muted hover:bg-surface-muted hover:text-navy-800",
      )}
    >
      {children}
    </Link>
  );
}

export function VisitorPicker({
  pageId,
  current,
}: {
  pageId: string;
  current: PreviewVisitorInput;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-muted px-4 py-2.5 lg:px-6">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-800">
        <UserRound size={13} aria-hidden="true" />
        Previewing as
      </span>

      <div
        role="group"
        aria-label="Visitor"
        className="inline-flex items-center gap-0.5 rounded-md border border-line-strong bg-white p-0.5"
      >
        {VISITORS.map(({ id, label }) => (
          <Chip key={id} active={current.visitor === id} to={href(pageId, current, { visitor: id })}>
            {label}
          </Chip>
        ))}
      </div>

      <div
        role="group"
        aria-label="Device"
        className="inline-flex items-center gap-0.5 rounded-md border border-line-strong bg-white p-0.5"
      >
        {DEVICES.map(({ id, label, Icon }) => (
          <Chip key={id} active={current.device === id} to={href(pageId, current, { device: id })}>
            <Icon size={13} aria-hidden="true" />
            {label}
          </Chip>
        ))}
      </div>

      <form method="get" className="flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="device" value={current.device} />
        <input type="hidden" name="visitor" value={current.visitor} />
        <label htmlFor="preview-utm-source" className="sr-only">
          UTM source
        </label>
        <input
          id="preview-utm-source"
          name="utmSource"
          defaultValue={current.utmSource ?? ""}
          placeholder="utm_source"
          className="h-7 w-28 rounded-md border border-line-strong px-2 text-xs focus:border-brand-red"
        />
        <label htmlFor="preview-utm-medium" className="sr-only">
          UTM medium
        </label>
        <input
          id="preview-utm-medium"
          name="utmMedium"
          defaultValue={current.utmMedium ?? ""}
          placeholder="utm_medium"
          className="h-7 w-28 rounded-md border border-line-strong px-2 text-xs focus:border-brand-red"
        />
        <button
          type="submit"
          className="h-7 rounded-md border border-line-strong px-2.5 text-xs text-navy-800 hover:border-navy-300"
        >
          Apply
        </button>
      </form>

      <span className="ml-auto text-2xs text-ink-subtle">
        No location: this application has no geo-IP.
      </span>
    </div>
  );
}
