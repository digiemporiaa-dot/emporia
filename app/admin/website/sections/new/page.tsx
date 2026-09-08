import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { BLOCK_LIBRARY } from "@/lib/content/blocks";
import { NewReusableForm } from "./new-reusable-form";

export const metadata: Metadata = { title: "New reusable section" };

export default async function NewReusableSectionPage() {
  const actor = await requireActorPage("/admin/website/sections");
  requirePermission(actor, "pages.create");

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <span>Website</span>
          <span aria-hidden="true"> / </span>
          <Link href="/admin/website/sections" className="hover:text-navy-800">
            Reusable sections
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">New reusable section</h1>
        <p className="mt-1.5 max-w-xl text-sm text-ink-muted">
          Pick the block it is built from. It starts as a draft, and cannot be placed on a page
          until it is published.
        </p>
      </header>
      <NewReusableForm blocks={BLOCK_LIBRARY.map((b) => ({ type: b.type, label: b.label }))} />
    </>
  );
}
