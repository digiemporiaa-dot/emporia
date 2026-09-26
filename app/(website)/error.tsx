"use client";

import { useEffect } from "react";
import { Container, CtaButton, Eyebrow } from "@/components/website/primitives";

/**
 * Website error boundary.
 *
 * Rendered inside the site shell, so a visitor keeps the header, footer and
 * navigation and can carry on rather than being dropped onto a bare page.
 *
 * Unlike the 404 beside it this is not an SEO surface — Next serves a 500 here
 * and a crawler will retry — so it optimises for the visitor getting somewhere
 * useful instead.
 */
export default function WebsiteError({
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
    <section>
      <Container className="py-20 lg:py-28">
        <Eyebrow>Something went wrong</Eyebrow>
        <h1 className="mt-4 max-w-2xl text-4xl text-navy-800">
          This page didn&rsquo;t load.
        </h1>
        <p className="mt-5 max-w-md text-lg text-ink-muted">
          The problem has been logged. Try again, or head somewhere else on the site.
        </p>
        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-ink-subtle">Reference: {error.digest}</p>
        ) : null}

        <div className="mt-9 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-11 items-center rounded-md bg-brand-red px-6 text-sm text-white hover:bg-red-600"
          >
            Try again
          </button>
          <CtaButton href="/" variant="outline">
            Back to home
          </CtaButton>
        </div>
      </Container>
    </section>
  );
}
