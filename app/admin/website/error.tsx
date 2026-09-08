"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Error boundary for the whole website CMS.
 *
 * Shows what someone can do next, never the underlying error: a stack trace or
 * a database message tells a visitor about the infrastructure and tells an
 * editor nothing they can act on (CLAUDE.md 11). The detail is in the server
 * logs, where it belongs.
 */
export default function WebsiteAdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surfaced in the browser console for a developer with devtools open; the
    // real record is the structured server-side log.
    console.error("website admin error", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <span className="mx-auto inline-flex size-11 items-center justify-center rounded-lg bg-red-50 text-brand-red-text">
        <AlertCircle size={20} aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-xl text-navy-800">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-muted">
        That page could not be loaded. Nothing has been changed or lost — try again, and if it keeps
        happening, quote the reference below.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-2xs text-ink-subtle">Reference {error.digest}</p>
      ) : null}
      <div className="mt-6 flex justify-center gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/admin/website/pages">
          <Button variant="secondary">Back to pages</Button>
        </Link>
      </div>
    </div>
  );
}
