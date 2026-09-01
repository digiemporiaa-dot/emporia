import Link from "next/link";
import { Button, Card, CardBody } from "@/components/ui";

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
