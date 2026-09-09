import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { FaqForm } from "../faq-form";

export const metadata: Metadata = { title: "Add FAQ" };

export default async function NewFaqPage() {
  const actor = await requireActorPage("/admin/website/faqs/new");
  requirePermission(actor, "faqs.create");

  const [services, cities, packages] = await Promise.all([
    db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.city.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.servicePackage.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/website/faqs" className="hover:text-navy-800">
            FAQs
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Add FAQ</h1>
      </header>
      <div className="max-w-3xl">
        <FaqForm services={services} cities={cities} packages={packages} />
      </div>
    </>
  );
}
