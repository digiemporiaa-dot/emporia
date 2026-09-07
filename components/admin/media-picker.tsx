"use client";

import * as React from "react";
import { FileText, Film, ImageIcon, Search, X } from "lucide-react";
import { Button } from "@/components/ui";
import { Uploader, type UploadedMedia } from "@/app/admin/media/uploader";

/**
 * The media picker used across the CMS.
 *
 * Renders a hidden input carrying the chosen media id, so it drops into any
 * existing form that posts to a server action — the action still validates the
 * id, and the service still checks the permission.
 */

export type PickedMedia = {
  id: string;
  url: string;
  filename: string;
  type: string;
};

type SearchRow = PickedMedia & { size: number; alt: string | null };

export function MediaPicker({
  name,
  label,
  value,
  hint,
  accept = "IMAGE",
  canUpload = true,
  onChange,
}: {
  name: string;
  label: string;
  value?: PickedMedia | null;
  hint?: string;
  accept?: "IMAGE" | "VIDEO" | "DOCUMENT" | "ANY";
  canUpload?: boolean;
  /**
   * Notified when the selection changes. Optional: the hidden input remains the
   * mechanism for form-posting callers, and this exists for the ones holding
   * their content in React state rather than in a form (the page builder).
   */
  onChange?: (media: PickedMedia | null) => void;
}) {
  const [picked, setPickedState] = React.useState<PickedMedia | null>(value ?? null);

  // One setter, so a new call site cannot change the selection without the
  // callback firing.
  const setPicked = React.useCallback(
    (next: PickedMedia | null) => {
      setPickedState(next);
      onChange?.(next);
    },
    [onChange],
  );
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<SearchRow[]>([]);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ perPage: "24" });
      if (query.trim()) params.set("search", query.trim());
      if (accept !== "ANY") params.set("type", accept);

      const response = await fetch(`/api/media/search?${params.toString()}`);
      const body = (await response.json()) as { rows: SearchRow[] } | { error: string };

      if (!response.ok || "error" in body) {
        throw new Error("error" in body ? body.error : "That search failed.");
      }
      setRows(body.rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That search failed.");
    } finally {
      setLoading(false);
    }
  }, [accept, query]);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const Icon = accept === "VIDEO" ? Film : accept === "DOCUMENT" ? FileText : ImageIcon;

  return (
    <div data-media-picker={name}>
      <input type="hidden" name={name} value={picked?.id ?? ""} />

      <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>

      {picked ? (
        <div className="flex items-center gap-3 rounded-md border border-line bg-white p-2">
          <div className="size-14 shrink-0 overflow-hidden rounded-sm bg-surface-muted">
            {picked.type === "IMAGE" ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary uploads on a third-party origin
              <img src={picked.url} alt="" className="h-full w-full object-contain" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Icon size={18} aria-hidden="true" className="text-ink-subtle" />
              </div>
            )}
          </div>
          <span className="min-w-0 flex-1 truncate text-xs text-navy-800">{picked.filename}</span>
          <div className="flex shrink-0 gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label={`Change the file for ${label}`}
              onClick={() => setOpen(true)}
            >
              Change
            </Button>
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="rounded-sm p-1 text-ink-subtle hover:text-brand-red"
            >
              <X size={14} aria-hidden="true" />
              <span className="sr-only">Remove {picked.filename}</span>
            </button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          // More than one picker can sit on a page — an item's own asset and an
          // approval's creative, say — so the button says which one it is.
          aria-label={`Choose a file for ${label}`}
          onClick={() => setOpen(true)}
        >
          <Icon size={14} aria-hidden="true" className="mr-1.5" />
          Choose a file
        </Button>
      )}

      {hint ? <p className="mt-1 text-2xs text-ink-subtle">{hint}</p> : null}

      {open ? (
        <div className="mt-3 rounded-lg border border-line bg-surface-muted p-3">
          <div className="flex items-center gap-1.5">
            <label htmlFor={`${name}-search`} className="sr-only">
              Search the media library
            </label>
            <div className="relative flex-1">
              <Search
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
              />
              <input
                id={`${name}-search`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void load();
                  }
                }}
                placeholder="Search files"
                className="h-9 w-full rounded-md border border-line-strong bg-white pl-8 pr-2 text-sm focus:border-brand-red"
              />
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={() => void load()}>
              Search
            </Button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-sm p-1.5 text-ink-subtle hover:text-brand-red"
            >
              <X size={14} aria-hidden="true" />
              <span className="sr-only">Close the picker</span>
            </button>
          </div>

          {error ? (
            <p role="alert" className="mt-2 text-xs text-brand-red-text">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="mt-3 text-xs text-ink-subtle">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="mt-3 text-xs text-ink-subtle">Nothing in the library matches.</p>
          ) : (
            <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(row);
                      setOpen(false);
                    }}
                    className="w-full overflow-hidden rounded-md border border-line bg-white text-left hover:border-brand-red"
                  >
                    <div className="aspect-square bg-surface-muted p-1.5">
                      {row.type === "IMAGE" ? (
                        // eslint-disable-next-line @next/next/no-img-element -- arbitrary uploads on a third-party origin
                        <img
                          src={row.url}
                          alt={row.alt ?? ""}
                          loading="lazy"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Icon size={18} aria-hidden="true" className="text-ink-subtle" />
                        </div>
                      )}
                    </div>
                    <p className="truncate border-t border-line px-1.5 py-1 text-2xs text-ink">
                      {row.filename}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {canUpload ? (
            <div className="mt-3 border-t border-line pt-3">
              <Uploader
                compact
                onUploaded={(uploaded: UploadedMedia) => {
                  setPicked(uploaded);
                  setOpen(false);
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
