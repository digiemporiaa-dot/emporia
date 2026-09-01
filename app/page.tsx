import Link from "next/link";
import { Button } from "@/components/ui";

/**
 * Placeholder root.
 *
 * The public marketing site is Phase 3. Rather than ship a mock homepage that
 * would have to be torn out, this states plainly what is built and what is not
 * (CLAUDE.md 15 rule 5).
 */
export default function Home() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-(--container-narrow) flex-col justify-center px-6 py-16">
      <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">Phase 2</p>
      <h1 className="mt-3 text-4xl text-navy-800">Emporia</h1>
      <p className="mt-4 max-w-prose text-ink-muted">
        The platform foundation is in place: database schema, authentication, role-based access
        control, design tokens, the admin shell and the audit trail. The public marketing site is
        built in Phase 3.
      </p>
      <div className="mt-8">
        <Link href="/admin">
          <Button>Go to admin</Button>
        </Link>
      </div>
    </main>
  );
}
