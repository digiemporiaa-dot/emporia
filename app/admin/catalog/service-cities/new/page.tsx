import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { ServiceCityPageForm } from "../page-form";

export const metadata: Metadata = { title: "New local page" };

export default async function NewServiceCityPage() {
  const actor = await requireActorPage("/admin/catalog/service-cities/new");
  requirePermission(actor, "catalog.create");

  const [services, cities] = await Promise.all([
    db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.city.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/catalog/service-cities" className="hover:text-navy-800">
            Local pages
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">New local page</h1>
        <p className="mt-1.5 max-w-2xl text-xs text-ink-subtle">
          Created as a draft. It publishes only once it has genuine local content.
        </p>
      </header>
      <div className="max-w-3xl">
        <ServiceCityPageForm services={services} cities={cities} />
      </div>
    </>
  );
}
