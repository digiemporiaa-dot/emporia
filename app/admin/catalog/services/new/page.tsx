import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { ServiceForm } from "../service-form";

export const metadata: Metadata = { title: "Add service" };

export default async function NewServicePage() {
  const actor = await requireActorPage("/admin/catalog/services/new");
  requirePermission(actor, "catalog.create");

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/catalog/services" className="hover:text-navy-800">
            Services
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Add service</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-subtle">
          SEO metadata is edited on the service&rsquo;s own screen once it exists.
        </p>
      </header>
      <div className="max-w-3xl">
        <ServiceForm />
      </div>
    </>
  );
}
