import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listTestimonials } from "@/lib/services/testimonial.service";
import {
  Badge,
  Button,
  Table,
  TableEmpty,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

export const metadata: Metadata = { title: "Testimonials" };

export default async function TestimonialsAdminPage() {
  const actor = await requireActorPage("/admin/website/testimonials");
  const testimonials = await listTestimonials(actor);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/website/pages" className="hover:text-navy-800">
              Website
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Testimonials</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Testimonials</h1>
        </div>
        {can(actor, "testimonials.create") ? (
          <Link href="/admin/website/testimonials/new">
            <Button size="sm">Add testimonial</Button>
          </Link>
        ) : null}
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Quote</TH>
              <TH>Who</TH>
              <TH>Service</TH>
              <TH>City</TH>
              <TH className="text-right">Rating</TH>
              <TH className="text-right">Order</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {testimonials.length === 0 ? (
              <TableEmpty
                colSpan={7}
                title="No testimonials yet"
                description="Testimonial bands on the site stay empty until one is published."
              />
            ) : (
              testimonials.map((testimonial) => (
                <TR key={testimonial.id}>
                  <TD>
                    <Link
                      href={`/admin/website/testimonials/${testimonial.id}`}
                      className="block max-w-md truncate font-medium text-navy-800 hover:text-brand-red"
                    >
                      {testimonial.quote}
                    </Link>
                  </TD>
                  <TD className="text-ink-muted">
                    {testimonial.authorName}
                    {testimonial.company ? (
                      <span className="block text-xs text-ink-subtle">{testimonial.company}</span>
                    ) : null}
                  </TD>
                  <TD className="text-ink-muted">{testimonial.service?.name ?? "—"}</TD>
                  <TD className="text-ink-muted">{testimonial.city?.name ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{testimonial.rating ?? "—"}</TD>
                  <TD className="text-right tabular-nums text-ink-subtle">{testimonial.order}</TD>
                  <TD>
                    <Badge tone={testimonial.status === "PUBLISHED" ? "success" : "neutral"}>
                      {testimonial.status}
                    </Badge>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
    </>
  );
}
