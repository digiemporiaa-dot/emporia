import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listFaqs } from "@/lib/services/faq.service";
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

export const metadata: Metadata = { title: "FAQs" };

export default async function FaqsAdminPage() {
  const actor = await requireActorPage("/admin/website/faqs");
  const faqs = await listFaqs(actor);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/website/pages" className="hover:text-navy-800">
              Website
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">FAQs</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">FAQs</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink-subtle">
            FAQs for a service, a city or a package. The ones on a service-city page are edited on
            that page, next to the rest of its local content.
          </p>
        </div>
        {can(actor, "faqs.create") ? (
          <Link href="/admin/website/faqs/new">
            <Button size="sm">Add FAQ</Button>
          </Link>
        ) : null}
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Question</TH>
              <TH>Attached to</TH>
              <TH className="text-right">Order</TH>
              <TH>Shown</TH>
            </TR>
          </THead>
          <TBody>
            {faqs.length === 0 ? (
              <TableEmpty
                colSpan={4}
                title="No FAQs yet"
                description="Add one against a service, a city or a package."
              />
            ) : (
              faqs.map((faq) => {
                const attached = [faq.service?.name, faq.city?.name, faq.package?.name]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <TR key={faq.id}>
                    <TD>
                      <Link
                        href={`/admin/website/faqs/${faq.id}`}
                        className="block max-w-lg truncate font-medium text-navy-800 hover:text-brand-red"
                      >
                        {faq.question}
                      </Link>
                    </TD>
                    <TD className="text-ink-muted">{attached || "—"}</TD>
                    <TD className="text-right tabular-nums text-ink-subtle">{faq.order}</TD>
                    <TD>
                      <Badge tone={faq.isActive ? "success" : "neutral"}>
                        {faq.isActive ? "Yes" : "Hidden"}
                      </Badge>
                    </TD>
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>
      </TableWrap>
    </>
  );
}
