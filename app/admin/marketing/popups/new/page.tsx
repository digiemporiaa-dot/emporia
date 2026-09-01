import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { PopupForm } from "../popup-form";

export const metadata: Metadata = { title: "Add popup" };

export default async function NewPopupPage() {
  const actor = await requireActorPage("/admin/marketing/popups/new");
  requirePermission(actor, "popups.create");

  const [services, cities, packages] = await Promise.all([
    db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.city.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.servicePackage.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/marketing/popups" className="hover:text-navy-800">
            Popups
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Add popup</h1>
      </header>
      <div className="max-w-4xl">
        <PopupForm services={services} cities={cities} packages={packages} />
      </div>
    </>
  );
}
