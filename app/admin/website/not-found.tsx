import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Button } from "@/components/ui";

export default function WebsiteAdminNotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <span className="mx-auto inline-flex size-11 items-center justify-center rounded-lg bg-surface-sunken text-ink-subtle">
        <FileQuestion size={20} aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-xl text-navy-800">Not found</h1>
      <p className="mt-2 text-sm text-ink-muted">
        This page or section does not exist. It may have been deleted — check the bin on the pages
        list before recreating it.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Link href="/admin/website/pages">
          <Button>Back to pages</Button>
        </Link>
        <Link href="/admin/website/sections">
          <Button variant="secondary">Reusable sections</Button>
        </Link>
      </div>
    </div>
  );
}
