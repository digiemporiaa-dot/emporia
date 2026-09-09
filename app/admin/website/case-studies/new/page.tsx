import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { CaseStudyForm } from "../case-study-form";

export const metadata: Metadata = { title: "Add case study" };

export default async function NewCaseStudyPage() {
  const actor = await requireActorPage("/admin/website/case-studies/new");
  requirePermission(actor, "casestudies.create");

  const [services, cities] = await Promise.all([
    db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.city.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/website/case-studies" className="hover:text-navy-800">
            Case studies
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Add case study</h1>
      </header>
      <div className="max-w-3xl">
        <CaseStudyForm services={services} cities={cities} />
      </div>
    </>
  );
}
