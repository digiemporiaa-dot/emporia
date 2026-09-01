import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { CityForm } from "../city-form";

export const metadata: Metadata = { title: "Add city" };

export default async function NewCityPage() {
  const actor = await requireActorPage("/admin/catalog/cities/new");
  requirePermission(actor, "catalog.create");

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/catalog/cities" className="hover:text-navy-800">
            Cities
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Add city</h1>
      </header>
      <CityForm />
    </>
  );
}
