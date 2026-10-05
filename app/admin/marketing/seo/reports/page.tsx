import type { Metadata, Route } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { isAppError } from "@/lib/errors";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { AUTO_DRAFT_DAY, getSeoReport, listSeoReports } from "@/lib/services/seo-intel/seo-report.service";
import { reportableMonths, reportMonthLabel } from "@/lib/seo-intel/report-doc";
import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle, Field, Select, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { SeoReportDocument } from "@/components/reports/seo-report-document";
import { SeoHeader } from "../seo-header";
import { ActionForm } from "../action-form";
import { DATE_TIME, PropertyPicker } from "../crawl-parts";
import { generateSeoReportAction, saveSeoReportNotesAction, setSeoReportPublishedAction } from "./actions";

export const metadata: Metadata = { title: "SEO reports" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  property: z.string().max(40).optional().catch(undefined),
  report: z.string().max(40).optional().catch(undefined),
});

export default async function SeoReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/reports");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property) ?? properties[0];
  const canConnect = can(actor, "seo.intelligence.connect");
  const canManage = can(actor, "seo.intelligence.manage");
  const description = `A monthly report for each website, frozen when it is generated. Drafted automatically on the ${AUTO_DRAFT_DAY}rd for last month; nothing reaches the client until you publish it.`;

  if (!property) {
    return (
      <>
        <SeoHeader current="reports" title="Reports" description={description} canConnect={canConnect} />
        <p className="text-sm text-ink-subtle">Add a website first.</p>
      </>
    );
  }

  const reports = await listSeoReports(actor, property.id);
  let selected: Awaited<ReturnType<typeof getSeoReport>> | null = null;
  const selectedId = params.report && reports.some((r) => r.id === params.report) ? params.report : null;
  if (selectedId) {
    try {
      selected = await getSeoReport(actor, selectedId);
    } catch (error) {
      if (!(isAppError(error) && error.code === "NOT_FOUND")) throw error;
    }
  }
  const published = new Set(reports.filter((r) => r.status === "PUBLISHED").map((r) => r.month));
  const months = reportableMonths(new Date()).filter((month) => !published.has(month));
  const href = (reportId?: string) => `/admin/marketing/seo/reports?property=${property.id}${reportId ? `&report=${reportId}` : ""}` as Route;
  const isClientSite = !property.client.isInternal;

  return (
    <>
      <SeoHeader current="reports" title="Reports" description={description} canConnect={canConnect} />
      <PropertyPicker id="report-property" properties={properties} current={property.id} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Monthly reports</CardTitle>
            <CardDescription>
              {isClientSite ? `Published reports appear in ${property.client.name}'s portal.` : "An agency website: reports stay internal."}
            </CardDescription>
          </CardHeader>
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Month</TH>
                  <TH>Status</TH>
                  <TH>Generated</TH>
                  <TH>Published</TH>
                  <TH className="text-right">Open</TH>
                </TR>
              </THead>
              <TBody>
                {reports.length === 0 ? (
                  <TableEmpty colSpan={5} title="No reports yet" description={`Last month's draft appears automatically on the ${AUTO_DRAFT_DAY}rd once Search Console or Analytics is connected, or generate one now.`} />
                ) : (
                  reports.map((report) => (
                    <TR key={report.id} className={report.id === selectedId ? "bg-surface-muted" : undefined}>
                      <TD>{reportMonthLabel(report.month)}</TD>
                      <TD>
                        <Badge tone={report.status === "PUBLISHED" ? "success" : "neutral"}>{report.status === "PUBLISHED" ? "Published" : "Draft"}</Badge>
                      </TD>
                      <TD className="text-xs text-ink-subtle">
                        {DATE_TIME.format(report.generatedAt)} · {report.generatedBy?.name ?? "Scheduled"}
                      </TD>
                      <TD className="text-xs text-ink-subtle">{report.publishedAt ? DATE_TIME.format(report.publishedAt) : "—"}</TD>
                      <TD className="text-right text-xs">
                        <Link href={href(report.id)} className="text-navy-800 underline underline-offset-4">
                          View
                        </Link>
                      </TD>
                    </TR>
                  ))
                )}
              </TBody>
            </Table>
          </TableWrap>
        </Card>

        {canManage ? (
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Generate a report</CardTitle>
              <CardDescription>Regenerating a draft replaces its figures and keeps its notes. A published report must be unpublished first.</CardDescription>
            </CardHeader>
            <CardBody>
              {months.length === 0 ? (
                <p className="text-sm text-ink-subtle">Every recent month is published.</p>
              ) : (
                <ActionForm action={generateSeoReportAction} label="Generate" pendingLabel="Generating…" hidden={{ propertyId: property.id }}>
                  <Field id="report-month" label="Month">
                    {(aria) => (
                      <Select {...aria} name="month" defaultValue={months[0]}>
                        {months.map((month) => (
                          <option key={month} value={month}>
                            {reportMonthLabel(month)}
                            {reports.some((r) => r.month === month) ? " (draft exists)" : ""}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </ActionForm>
              )}
            </CardBody>
          </Card>
        ) : null}
      </div>

      {selected ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card className="min-w-0">
            <CardBody>
              <SeoReportDocument data={selected.data} notes={selected.notes} />
            </CardBody>
          </Card>
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{reportMonthLabel(selected.month)}</CardTitle>
                <CardDescription>{selected.status === "PUBLISHED" ? "Published — the client can read it." : "Draft — only staff can see it."}</CardDescription>
              </CardHeader>
              <CardBody className="space-y-3">
                <a href={`/print/seo-reports/${selected.id}`} target="_blank" rel="noopener" className="block text-xs text-navy-800 underline underline-offset-4">
                  Print or save as PDF
                </a>
                {canManage && isClientSite ? (
                  <ActionForm
                    action={setSeoReportPublishedAction}
                    label={selected.status === "PUBLISHED" ? "Unpublish" : "Publish to the client"}
                    pendingLabel="Saving…"
                    variant={selected.status === "PUBLISHED" ? "secondary" : "primary"}
                    hidden={{ reportId: selected.id, published: selected.status === "PUBLISHED" ? "false" : "true" }}
                    confirm={selected.status === "PUBLISHED" ? undefined : `Publish the ${reportMonthLabel(selected.month)} report to ${property.client.name}? Their portal users will be emailed.`}
                  />
                ) : null}
              </CardBody>
            </Card>
            {canManage && selected.status === "DRAFT" ? (
              <Card>
                <CardHeader>
                  <CardTitle>Notes for the client</CardTitle>
                  <CardDescription>Shown at the top of the report. Plain text, up to 5,000 characters.</CardDescription>
                </CardHeader>
                <CardBody>
                  <ActionForm action={saveSeoReportNotesAction} label="Save notes" pendingLabel="Saving…" variant="secondary" hidden={{ reportId: selected.id }}>
                    <Field id="report-notes" label="Notes">
                      {(aria) => <Textarea {...aria} name="notes" rows={8} maxLength={5_000} defaultValue={selected.notes ?? ""} />}
                    </Field>
                  </ActionForm>
                </CardBody>
              </Card>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
