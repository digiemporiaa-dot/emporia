import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { PackageForm } from "../package-form";

export const metadata: Metadata = { title: "Add package" };

export default async function NewPackagePage() {
  const actor = await requireActorPage("/admin/catalog/packages/new");
  requirePermission(actor, "catalog.create");

  const services = await db.service.findMany({
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/catalog/packages" className="hover:text-navy-800">
            Packages
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Add package</h1>
      </header>
      <div className="max-w-3xl">
        <PackageForm services={services} />
      </div>
    </>
  );
}
