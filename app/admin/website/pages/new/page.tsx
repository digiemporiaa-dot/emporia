import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { NewPageForm } from "./new-page-form";

export const metadata: Metadata = { title: "New page" };

export default async function NewPagePage() {
  const actor = await requireActorPage("/admin/website/pages");
  requirePermission(actor, "pages.create");

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <span>Website</span>
          <span aria-hidden="true"> / </span>
          <Link href="/admin/website/pages" className="hover:text-navy-800">
            Pages
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">New page</h1>
        <p className="mt-1.5 max-w-xl text-sm text-ink-muted">
          The page is created as a draft. Nothing is public until you publish it.
        </p>
      </header>
      <NewPageForm />
    </>
  );
}
