import Link from "next/link";
import { Button, Card, CardBody } from "@/components/ui";

/**
 * Admin 404.
 *
 * There is deliberately no `loading.tsx` above the admin routes. A loading
 * boundary makes Next stream the shell immediately, so the 200 is already sent
 * by the time `notFound()` runs — and a record the actor is not permitted to
 * see would answer 200 with a skeleton. No data leaked either way, but a
 * successful status on an authorization boundary is misleading to anything
 * watching, so the skeleton was traded for the correct code.
 */
export default function AdminNotFound() {
  return (
    <Card>
      <CardBody className="py-12 text-center">
        <p className="text-sm font-medium text-navy-800">Not found</p>
        <p className="mx-auto mt-1.5 max-w-md text-xs text-ink-subtle">
          That record does not exist, or it is not available to your account.
        </p>
        <div className="mt-5 flex justify-center">
          <Link href="/admin">
            <Button variant="secondary">Back to dashboard</Button>
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
