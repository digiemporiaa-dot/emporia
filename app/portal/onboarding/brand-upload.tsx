"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button, Field, Select } from "@/components/ui";
import { confirmBrandAction, presignBrandAction } from "./actions";

/**
 * Upload a brand file straight to storage. The server issues a presigned URL
 * for exactly this type and size, the browser PUTs the bytes, and the server
 * then checks what actually landed before filing it (lib/services/media).
 */
export function BrandUpload() {
  const router = useRouter();
  const [kind, setKind] = React.useState<"LOGO" | "GUIDELINES" | "OTHER">("LOGO");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "error" | "ok"; text: string } | null>(null);
  const input = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const presigned = await presignBrandAction({ filename: file.name, contentType: file.type, size: file.size, kind });
      if (!presigned.ok) throw new Error(presigned.message);
      const put = await fetch(presigned.upload.url, { method: "PUT", headers: presigned.upload.headers, body: file });
      if (!put.ok) throw new Error("The file could not be uploaded. Try again.");
      const confirmed = await confirmBrandAction({ uploadId: presigned.upload.uploadId, kind });
      if (!confirmed.ok) throw new Error(confirmed.message);
      setMessage({ tone: "ok", text: `${file.name} uploaded.` });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The upload failed." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field id="brand-kind" label="What is it?">
        {(aria) => (
          <Select {...aria} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="w-44">
            <option value="LOGO">Logo</option>
            <option value="GUIDELINES">Brand guidelines</option>
            <option value="OTHER">Other</option>
          </Select>
        )}
      </Field>
      <input
        ref={input}
        id="brand-file"
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
        <Upload size={14} aria-hidden="true" />
        {busy ? "Uploading…" : "Choose a file"}
      </Button>
      <p className="w-full text-2xs text-ink-subtle">JPEG, PNG, WebP or PDF, up to 10 MB for images.</p>
      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={`w-full text-xs ${message.tone === "error" ? "text-brand-red-text" : "text-success"}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
