"use client";

import { useEffect } from "react";
import { Button, Card, CardBody } from "@/components/ui";

/**
 * Portal error boundary.
 *
 * Separate from the admin's because the reader is different: a client, not a
 * colleague. It says who to contact rather than inviting them to reason about
 * what went wrong, and it never suggests a permission problem — a client seeing
 * "you may not have permission" on their own account would reasonably conclude
 * something is wrong with their access.
 *
 * The error and stack stay in the server logs (CLAUDE.md 11); `digest` is the
 * server-side correlation id and is the one thing worth showing, because it is
 * what makes a support message actionable.
 */
export default function PortalError({
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
    <Card>
      <CardBody className="py-12 text-center">
        <p className="text-sm font-medium text-navy-800">This page could not be loaded</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-ink-subtle">
          Something went wrong at our end and it has been logged. Try again in a moment — if it
          keeps happening, send us a message with the reference below and we will look into it.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-2xs text-ink-subtle">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-5 flex justify-center">
          <Button variant="secondary" onClick={reset}>
            Try again
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
