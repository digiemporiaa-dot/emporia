import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { TestimonialForm } from "../testimonial-form";

export const metadata: Metadata = { title: "Add testimonial" };

export default async function NewTestimonialPage() {
  const actor = await requireActorPage("/admin/website/testimonials/new");
  requirePermission(actor, "testimonials.create");

  const [services, cities] = await Promise.all([
    db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.city.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/website/testimonials" className="hover:text-navy-800">
            Testimonials
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Add testimonial</h1>
      </header>
      <div className="max-w-3xl">
        <TestimonialForm services={services} cities={cities} />
      </div>
    </>
  );
}
