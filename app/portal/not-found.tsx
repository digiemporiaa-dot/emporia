import Link from "next/link";
import { Card, CardBody } from "@/components/ui";

/**
 * Portal 404, rendered inside the portal shell so a client keeps the navigation
 * and does not land on the public site's 404 wondering whether they were signed
 * out.
 *
 * Deliberately says "not available to you" rather than "does not exist". A
 * project belonging to another client reaches here through the same path as a
 * mistyped id — the service refuses both identically (CLAUDE.md 2 rule 3) — and
 * the wording must not let one be told apart from the other.
 */
export default function PortalNotFound() {
  return (
    <Card>
      <CardBody className="py-12 text-center">
        <p className="text-sm font-medium text-navy-800">Not available</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-ink-subtle">
          That page is not available to you. It may have been removed, or the address may be
          mistyped.
        </p>
        <div className="mt-5">
          <Link
            href="/portal"
            className="text-xs text-brand-red underline underline-offset-4 hover:text-red-700"
          >
            Back to your overview
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
