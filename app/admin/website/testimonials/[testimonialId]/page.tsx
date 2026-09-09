import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { getTestimonial } from "@/lib/services/testimonial.service";
import { db } from "@/lib/db";
import { DeleteButton } from "@/components/admin/delete-button";
import { deleteTestimonialAction } from "../../content-actions";
import { TestimonialForm } from "../testimonial-form";

export const metadata: Metadata = { title: "Testimonial" };

export default async function TestimonialDetailPage({
  params,
}: {
  params: Promise<{ testimonialId: string }>;
}) {
  const { testimonialId } = await params;
  const actor = await requireActorPage(`/admin/website/testimonials/${testimonialId}`);
  const testimonial = await getTestimonial(actor, testimonialId);

  const [services, cities] = await Promise.all([
    db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.city.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/website/testimonials" className="hover:text-navy-800">
              Testimonials
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">{testimonial.authorName}</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">{testimonial.authorName}</h1>
        </div>
        {can(actor, "testimonials.delete") ? (
          <DeleteButton
            id={testimonial.id}
            label={testimonial.authorName}
            description="The testimonial is removed. This cannot be undone."
            action={deleteTestimonialAction}
            redirectTo="/admin/website/testimonials"
          />
        ) : null}
      </header>

      <div className="max-w-3xl">
        <TestimonialForm
          services={services}
          cities={cities}
          testimonial={{
            id: testimonial.id,
            authorName: testimonial.authorName,
            authorRole: testimonial.authorRole,
            company: testimonial.company,
            quote: testimonial.quote,
            rating: testimonial.rating,
            serviceId: testimonial.serviceId,
            cityId: testimonial.cityId,
            status: testimonial.status,
            order: testimonial.order,
            avatar: testimonial.avatar
              ? {
                  id: testimonial.avatar.id,
                  url: testimonial.avatar.url,
                  filename: testimonial.avatar.alt ?? "Photo",
                  type: "IMAGE",
                }
              : null,
          }}
        />
      </div>
    </>
  );
}
