"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, UploadCloud } from "lucide-react";
import { ACCEPT_ATTRIBUTE } from "@/lib/media/types";

/**
 * Upload widget.
 *
 * The bytes go straight from the browser to the bucket over a presigned URL —
 * this server never handles the file. The three steps are: ask for a URL,
 * PUT the file, then ask the server to verify what landed. Only that last step
 * creates a Media row, so a file the server refuses leaves nothing behind
 * (CLAUDE.md 11).
 */

type Upload = {
  id: string;
  name: string;
  size: number;
  progress: number;
  status: "uploading" | "verifying" | "done" | "failed";
  error?: string;
};

export type UploadedMedia = {
  id: string;
  url: string;
  filename: string;
  type: string;
  size: number;
};

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** PUT with progress, which fetch cannot report. */
function put(url: string, headers: Record<string, string>, file: File, onProgress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);

    for (const [key, value] of Object.entries(headers)) {
      // The browser sets content-length itself and refuses to have it set.
      if (key.toLowerCase() === "content-length") continue;
      request.setRequestHeader(key, value);
    }

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`The storage service refused the file (${request.status}).`));
    });
    request.addEventListener("error", () => reject(new Error("The upload failed.")));
    request.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));

    request.send(file);
  });
}

export function Uploader({
  folderId,
  replacesId,
  onUploaded,
  compact = false,
}: {
  folderId?: string | null;
  replacesId?: string | null;
  onUploaded?: (media: UploadedMedia) => void;
  compact?: boolean;
}) {
  const router = useRouter();
  // More than one uploader can be on the page — the library's own, and one
  // inside the detail panel for a replacement. They must not share an input id,
  // or the label points at the wrong control and a click lands on the wrong
  // uploader.
  const inputId = `media-file-input-${React.useId().replace(/:/g, "")}${replacesId ? "-replace" : ""}`;
  const [uploads, setUploads] = React.useState<Upload[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const update = (id: string, patch: Partial<Upload>) =>
    setUploads((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const send = React.useCallback(
    async (file: File) => {
      const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setUploads((current) => [
        ...current,
        { id, name: file.name, size: file.size, progress: 0, status: "uploading" },
      ]);

      try {
        const presignResponse = await fetch("/api/media/presign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            // The browser's guess. The server checks the bytes regardless.
            contentType: file.type,
            size: file.size,
            folderId: folderId ?? null,
            replacesId: replacesId ?? null,
          }),
        });

        const ticket = (await presignResponse.json()) as
          | { url: string; headers: Record<string, string>; uploadId: string }
          | { error: string };

        if (!presignResponse.ok || "error" in ticket) {
          throw new Error("error" in ticket ? ticket.error : "That upload could not be started.");
        }

        await put(ticket.url, ticket.headers, file, (percent) => update(id, { progress: percent }));

        update(id, { status: "verifying", progress: 100 });

        const confirmResponse = await fetch("/api/media/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uploadId: ticket.uploadId }),
        });

        const confirmed = (await confirmResponse.json()) as
          | { media: UploadedMedia }
          | { error: string };

        if (!confirmResponse.ok || "error" in confirmed) {
          throw new Error("error" in confirmed ? confirmed.error : "That file was refused.");
        }

        update(id, { status: "done" });
        onUploaded?.(confirmed.media);
        router.refresh();
      } catch (error) {
        update(id, {
          status: "failed",
          error: error instanceof Error ? error.message : "That upload failed.",
        });
      }
    },
    [folderId, onUploaded, replacesId, router],
  );

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) void send(file);
  };

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        className={`rounded-lg border border-dashed text-center transition-colors ${
          dragging ? "border-brand-red bg-red-50" : "border-line-strong bg-surface-muted"
        } ${compact ? "p-4" : "p-8"}`}
      >
        <UploadCloud
          size={compact ? 18 : 24}
          aria-hidden="true"
          className="mx-auto text-ink-subtle"
        />
        <p className={`mt-2 text-navy-800 ${compact ? "text-xs" : "text-sm"}`}>
          Drop files here, or{" "}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="underline underline-offset-2 hover:text-brand-red"
          >
            choose them
          </button>
        </p>
        <p className="mt-1 text-2xs text-ink-subtle">
          JPG, PNG, WEBP, SVG, GIF, MP4, PDF, DOCX, XLSX
        </p>

        <label className="sr-only" htmlFor={inputId}>
          {replacesId ? "Replacement file" : "Files to upload"}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          data-upload-role={replacesId ? "replace" : "add"}
          type="file"
          multiple={!replacesId}
          accept={ACCEPT_ATTRIBUTE}
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = "";
          }}
          className="sr-only"
        />
      </div>

      {uploads.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {uploads.map((upload) => (
            <li key={upload.id} className="rounded-md border border-line bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-xs text-navy-800">{upload.name}</span>
                <span className="shrink-0 text-2xs tabular-nums text-ink-subtle">
                  {human(upload.size)}
                </span>
              </div>

              {upload.status === "uploading" || upload.status === "verifying" ? (
                <div
                  role="progressbar"
                  aria-valuenow={upload.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Uploading ${upload.name}`}
                  className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-sunken"
                >
                  <div
                    className="h-full bg-brand-red transition-[width] duration-(--duration-fast)"
                    style={{ width: `${upload.progress}%` }}
                  />
                </div>
              ) : null}

              <p className="mt-1 flex items-center gap-1 text-2xs">
                {upload.status === "uploading" ? (
                  <span className="text-ink-subtle">{upload.progress}%</span>
                ) : upload.status === "verifying" ? (
                  <span className="text-ink-subtle">Checking the file…</span>
                ) : upload.status === "done" ? (
                  <span className="flex items-center gap-1 text-success">
                    <CheckCircle2 size={11} aria-hidden="true" />
                    Added
                  </span>
                ) : (
                  <span role="alert" className="flex items-start gap-1 text-brand-red">
                    <AlertCircle size={11} aria-hidden="true" className="mt-0.5 shrink-0" />
                    {upload.error}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
