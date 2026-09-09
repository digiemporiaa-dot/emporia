import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { getFaq } from "@/lib/services/faq.service";
import { db } from "@/lib/db";
import { DeleteButton } from "@/components/admin/delete-button";
import { deleteFaqAction } from "../../content-actions";
import { FaqForm } from "../faq-form";

export const metadata: Metadata = { title: "FAQ" };

export default async function FaqDetailPage({ params }: { params: Promise<{ faqId: string }> }) {
  const { faqId } = await params;
  const actor = await requireActorPage(`/admin/website/faqs/${faqId}`);
  const faq = await getFaq(actor, faqId);

  const [services, cities, packages] = await Promise.all([
    db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.city.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.servicePackage.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/website/faqs" className="hover:text-navy-800">
              FAQs
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Edit</span>
          </nav>
          <h1 className="mt-1.5 max-w-2xl truncate text-2xl text-navy-800">{faq.question}</h1>
        </div>
        {can(actor, "faqs.delete") ? (
          <DeleteButton
            id={faq.id}
            label="this FAQ"
            description="The question and answer are removed. This cannot be undone."
            action={deleteFaqAction}
            redirectTo="/admin/website/faqs"
          />
        ) : null}
      </header>

      <div className="max-w-3xl">
        <FaqForm services={services} cities={cities} packages={packages} faq={faq} />
      </div>
    </>
  );
}
