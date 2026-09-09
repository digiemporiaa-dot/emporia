import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listCaseStudies } from "@/lib/services/case-study.service";
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

export const metadata: Metadata = { title: "Case studies" };

export default async function CaseStudiesAdminPage() {
  const actor = await requireActorPage("/admin/website/case-studies");
  const studies = await listCaseStudies(actor);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/website/pages" className="hover:text-navy-800">
              Website
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Case studies</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Case studies</h1>
        </div>
        {can(actor, "casestudies.create") ? (
          <Link href="/admin/website/case-studies/new">
            <Button size="sm">Add case study</Button>
          </Link>
        ) : null}
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Case study</TH>
              <TH>Client</TH>
              <TH>Service</TH>
              <TH>City</TH>
              <TH className="text-right">Metrics</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {studies.length === 0 ? (
              <TableEmpty
                colSpan={6}
                title="No case studies yet"
                description="Case-study bands on the site stay empty until one is published."
              />
            ) : (
              studies.map((study) => (
                <TR key={study.id}>
                  <TD>
                    <Link
                      href={`/admin/website/case-studies/${study.id}`}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {study.title}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-ink-subtle">{study.slug}</p>
                  </TD>
                  <TD className="text-ink-muted">{study.clientName}</TD>
                  <TD className="text-ink-muted">{study.service?.name ?? "—"}</TD>
                  <TD className="text-ink-muted">{study.city?.name ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{study._count.metrics}</TD>
                  <TD>
                    <Badge tone={study.status === "PUBLISHED" ? "success" : "neutral"}>
                      {study.status}
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
