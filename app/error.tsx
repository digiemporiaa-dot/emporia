"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui";

/**
 * Root error boundary.
 *
 * Renders a plain message. The raw error and stack stay in the server logs and
 * are never shown to a user (CLAUDE.md 11); `digest` is the server-side
 * correlation id, which is safe to display.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-(--container-narrow) flex-col justify-center px-6">
      <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">Error</p>
      <h1 className="mt-3 text-3xl text-navy-800">Something went wrong</h1>
      <p className="mt-3 max-w-prose text-ink-muted">
        The problem has been logged. Try again, and if it keeps happening quote the reference below.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-xs text-ink-subtle">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-7">
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
