import Link from "next/link";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-(--container-narrow) flex-col justify-center px-6">
      <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">404</p>
      <h1 className="mt-3 text-3xl text-navy-800">We couldn&rsquo;t find that page</h1>
      <p className="mt-3 max-w-prose text-ink-muted">
        The address may be mistyped, or the page may have moved.
      </p>
      <div className="mt-7">
        <Link href="/">
          <Button variant="secondary">Back to home</Button>
        </Link>
      </div>
    </main>
  );
}
