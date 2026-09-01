"use client";

import { useEffect } from "react";
import { Button, Card, CardBody } from "@/components/ui";

export default function AdminError({
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
        <p className="text-sm font-medium text-navy-800">This section could not be loaded</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-ink-subtle">
          You may not have permission, or something went wrong on our side. The details have been
          logged.
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
