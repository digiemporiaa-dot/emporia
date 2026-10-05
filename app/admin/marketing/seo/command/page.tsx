import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { z } from "zod";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listProperties } from "@/lib/services/seo-intel/property.service";
import { listOpportunities, opportunitiesByWebsite, STATUS_FILTERS, taskTargets, type StatusFilter } from "@/lib/services/seo-intel/opportunity.service";
import { CLICK_SEVERITY } from "@/lib/seo-intel/engine/opportunities";
import { Pagination } from "@/components/admin/pagination";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Select } from "@/components/ui";
import { SeoHeader } from "../seo-header";
import { ActionForm } from "../action-form";
import {
  assignOpportunityAction,
  createOpportunityTaskAction,
  detectNowAction,
  dismissOpportunityAction,
  doneOpportunityAction,
  reopenOpportunityAction,
} from "../actions";
import { DATE_TIME } from "../crawl-parts";
import { formatCount } from "../overview-parts";

export const metadata: Metadata = { title: "Command Center" };
export const dynamic = "force-dynamic";

const SOURCES = ["KEYWORDS", "CONTENT", "TECHNICAL", "INDEXATION", "LINKS", "LOCAL", "NAP", "REVIEWS", "INTERNATIONAL", "ANALYTICS", "CHANGES"] as const;
const SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const;
const EFFORTS = ["LOW", "MEDIUM", "HIGH"] as const;

const paramsSchema = z.object({
  property: z.string().max(40).optional().catch(undefined),
  status: z.enum(STATUS_FILTERS).catch("active"),
  source: z.enum(SOURCES).optional().catch(undefined),
  severity: z.enum(SEVERITIES).optional().catch(undefined),
  effort: z.enum(EFFORTS).optional().catch(undefined),
  assignee: z.enum(["me", "none"]).optional().catch(undefined),
  q: z.string().trim().max(200).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
const PAGE_SIZE = 25;

const SOURCE_LABEL: Record<(typeof SOURCES)[number], string> = {
  KEYWORDS: "Keywords",
  CONTENT: "Content",
  TECHNICAL: "Technical",
  INDEXATION: "Indexation",
  LINKS: "Internal links",
  LOCAL: "Local coverage",
  NAP: "Name, address, phone",
  REVIEWS: "Google reviews",
  INTERNATIONAL: "International",
  ANALYTICS: "Organic conversions",
  CHANGES: "What changed",
};
const STATUS_LABEL: Record<StatusFilter, string> = { active: "Open and in progress", OPEN: "Open", TASK_CREATED: "Task created", DONE: "Done", DISMISSED: "Dismissed", RESOLVED: "Resolved by detector" };
const SEVERITY_TONE = { HIGH: "red", MEDIUM: "warning", LOW: "neutral" } as const;
const EFFORT_LABEL = { LOW: "Low effort", MEDIUM: "Medium effort", HIGH: "High effort" } as const;

function impactText(impact: number, unit: string) {
  switch (unit) {
    case "clicks":
      return `${formatCount(impact)} clicks`;
    case "impressions":
      return `${formatCount(impact)} impressions`;
    case "pages":
      return `${formatCount(impact)} page${impact === 1 ? "" : "s"}`;
    case "links":
      return `${formatCount(impact)} link${impact === 1 ? "" : "s"} to add`;
    case "reviews":
      return `${formatCount(impact)} review${impact === 1 ? "" : "s"}`;
    case "days":
      return `${formatCount(impact)} day${impact === 1 ? "" : "s"}`;
    case "sessions":
      return `${formatCount(impact)} organic sessions`;
    default:
      return "Alert";
  }
}

/** Where the evidence lives, for each source. */
function evidenceHref(row: { source: (typeof SOURCES)[number]; type: string; property: { id: string } }): Route {
  const p = row.property.id;
  switch (row.source) {
    case "KEYWORDS":
      return `/admin/marketing/seo/opportunities?property=${p}` as Route;
    case "CONTENT":
      return `/admin/marketing/seo/content?property=${p}&type=${row.type}` as Route;
    case "TECHNICAL":
      return `/admin/marketing/seo/technical?property=${p}&rule=${row.type.replace("technical:", "")}` as Route;
    case "INDEXATION":
      return `/admin/marketing/seo/indexation?property=${p}&conflict=${row.type}` as Route;
    case "LINKS":
      return `/admin/marketing/seo/links?property=${p}` as Route;
    case "LOCAL":
      return `/admin/marketing/seo/local?property=${p}&status=${row.type === "local-gap" ? "gap" : "not-indexable"}` as Route;
    case "NAP":
      return `/admin/marketing/seo/local/nap?property=${p}` as Route;
    case "REVIEWS":
      return `/admin/marketing/seo/local/reviews?property=${p}` as Route;
    case "INTERNATIONAL":
      return `/admin/marketing/seo/international?property=${p}` as Route;
    case "ANALYTICS":
      return `/admin/marketing/seo/revenue?property=${p}` as Route;
    case "CHANGES":
      return `/admin/marketing/seo?property=${p}` as Route;
  }
}

export default async function CommandCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorPage("/admin/marketing/seo/command");
  requirePermission(actor, "seo.intelligence.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])));
  const canConnect = can(actor, "seo.intelligence.connect");
  const canManage = can(actor, "seo.opportunities.manage");
  const canTask = canManage && can(actor, "tasks.create");

  const properties = await listProperties(actor, { status: "active" });
  const property = properties.find((candidate) => candidate.id === params.property);
  const [result, sites] = await Promise.all([
    listOpportunities(actor, { propertyId: property?.id, status: params.status, source: params.source, severity: params.severity, effort: params.effort, assigneeId: params.assignee, q: params.q }, { page: params.page, perPage: PAGE_SIZE }),
    opportunitiesByWebsite(actor),
  ]);
  const targets = new Map<string, Awaited<ReturnType<typeof taskTargets>>>();
  if (canManage) {
    for (const id of new Set(result.list.rows.map((row) => row.property.id))) targets.set(id, await taskTargets(actor, id));
  }
  const staff = [...targets.values()][0]?.staff ?? [];

  const link = (overrides: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    const merged = { property: property?.id, status: params.status === "active" ? undefined : params.status, source: params.source, severity: params.severity, effort: params.effort, assignee: params.assignee, q: params.q, ...overrides };
    for (const [key, value] of Object.entries(merged)) if (value) query.set(key, value);
    return `/admin/marketing/seo/command${query.size ? `?${query}` : ""}` as Route;
  };

  return (
    <>
      <SeoHeader
        current="command"
        title="Command Center"
        description="Every SEO finding worth acting on, across all websites, worst first. Detected daily from the rules on the other tabs; a finding that stops being true is resolved by itself."
        query={property ? `?property=${property.id}` : ""}
        canConnect={canConnect}
      />

      <form className="mb-4 flex flex-wrap items-end gap-2">
        <label htmlFor="cc-property" className="sr-only">Website</label>
        <Select id="cc-property" name="property" defaultValue={property?.id ?? ""} className="w-full max-w-xs">
          <option value="">All websites</option>
          {properties.map((option) => (
            <option key={option.id} value={option.id}>
              {option.client.name} — {option.displayName}
            </option>
          ))}
        </Select>
        <label htmlFor="cc-status" className="sr-only">Status</label>
        <Select id="cc-status" name="status" defaultValue={params.status} className="w-44">
          {STATUS_FILTERS.map((status) => (
            <option key={status} value={status}>{STATUS_LABEL[status]}</option>
          ))}
        </Select>
        <label htmlFor="cc-source" className="sr-only">Source</label>
        <Select id="cc-source" name="source" defaultValue={params.source ?? ""} className="w-40">
          <option value="">All sources</option>
          {SOURCES.map((source) => (
            <option key={source} value={source}>{SOURCE_LABEL[source]}{result.bySource[source] ? ` (${result.bySource[source]})` : ""}</option>
          ))}
        </Select>
        <label htmlFor="cc-severity" className="sr-only">Severity</label>
        <Select id="cc-severity" name="severity" defaultValue={params.severity ?? ""} className="w-36">
          <option value="">Any severity</option>
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>{severity.charAt(0) + severity.slice(1).toLowerCase()}</option>
          ))}
        </Select>
        <label htmlFor="cc-effort" className="sr-only">Effort</label>
        <Select id="cc-effort" name="effort" defaultValue={params.effort ?? ""} className="w-36">
          <option value="">Any effort</option>
          {EFFORTS.map((effort) => (
            <option key={effort} value={effort}>{EFFORT_LABEL[effort]}</option>
          ))}
        </Select>
        <label htmlFor="cc-assignee" className="sr-only">Assignee</label>
        <Select id="cc-assignee" name="assignee" defaultValue={params.assignee ?? ""} className="w-36">
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="none">Unassigned</option>
        </Select>
        <label htmlFor="cc-q" className="sr-only">Search</label>
        <Input id="cc-q" name="q" defaultValue={params.q} placeholder="Page, query or title" className="w-48" />
        <Button type="submit" variant="secondary">Show</Button>
      </form>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-3">
          <p className="text-2xs text-ink-subtle">
            {formatCount(result.list.total)} {STATUS_LABEL[params.status].toLowerCase()}
            {result.byStatus.TASK_CREATED ? ` · ${result.byStatus.TASK_CREATED} with tasks` : ""}
          </p>
          {result.list.rows.length === 0 ? (
            <Card>
              <CardBody className="text-sm text-ink-subtle">
                Nothing here. {params.status === "active" ? "Detection runs daily once a website has Search Console data or a finished crawl." : ""}
              </CardBody>
            </Card>
          ) : null}
          {result.list.rows.map((row) => {
            const target = targets.get(row.property.id);
            const closed = row.status === "DONE" || row.status === "DISMISSED" || row.status === "RESOLVED";
            return (
              <Card key={row.id}>
                <CardBody className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <Badge tone={SEVERITY_TONE[row.severity]}>{row.severity.charAt(0) + row.severity.slice(1).toLowerCase()}</Badge>
                        <Link href={evidenceHref(row)} className="min-w-0 break-words text-sm font-medium text-navy-800 hover:text-brand-red">
                          {row.title}
                        </Link>
                      </p>
                      <p className="mt-1 text-2xs text-ink-subtle">
                        {row.property.client.name} — {row.property.displayName} · {SOURCE_LABEL[row.source]} · {EFFORT_LABEL[row.effort]} · first seen {DATE_TIME.format(row.firstSeenAt)}
                        {row.status === "RESOLVED" && row.resolvedAt ? ` · resolved ${DATE_TIME.format(row.resolvedAt)}` : ""}
                      </p>
                      {row.url ? <p className="mt-0.5 truncate font-mono text-2xs text-ink-muted" title={row.url}>{row.url}</p> : null}
                      {row.dismissReason ? <p className="mt-0.5 text-2xs text-ink-muted">Dismissed: {row.dismissReason}</p> : null}
                    </div>
                    <div className="text-right">
                      <p className="text-sm tabular-nums text-navy-800">{impactText(row.impact, row.impactUnit)}</p>
                      <p className="text-2xs text-ink-subtle">
                        {row.status === "TASK_CREATED" && row.projectTask ? (
                          <Link href={`/admin/projects/${row.projectTask.projectId}` as Route} className="text-navy-800 underline underline-offset-2">
                            Task: {row.projectTask.status.replace("_", " ").toLowerCase()}
                          </Link>
                        ) : (
                          STATUS_LABEL[row.status as StatusFilter]
                        )}
                        {row.assignee ? ` · ${row.assignee.name}` : ""}
                      </p>
                    </div>
                  </div>

                  {canManage ? (
                    <details className="rounded-md border border-line px-3 py-2">
                      <summary className="cursor-pointer text-xs text-navy-800">Act on this</summary>
                      <div className="mt-3 grid gap-4 md:grid-cols-2">
                        {canTask && row.status === "OPEN" && target ? (
                          target.projects.length ? (
                            <ActionForm action={createOpportunityTaskAction} label="Create task" variant="primary" hidden={{ opportunityId: row.id }}>
                              <label className="block text-2xs text-ink-subtle" htmlFor={`p-${row.id}`}>Project</label>
                              <Select id={`p-${row.id}`} name="projectId" defaultValue={target.defaultProjectId ?? target.projects[0]?.id}>
                                {target.projects.map((project) => (
                                  <option key={project.id} value={project.id}>{project.code} — {project.name}</option>
                                ))}
                              </Select>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-2xs text-ink-subtle" htmlFor={`a-${row.id}`}>Assignee</label>
                                  <Select id={`a-${row.id}`} name="assigneeId" defaultValue="">
                                    <option value="">Nobody yet</option>
                                    {staff.map((user) => (
                                      <option key={user.id} value={user.id}>{user.name}</option>
                                    ))}
                                  </Select>
                                </div>
                                <div>
                                  <label className="block text-2xs text-ink-subtle" htmlFor={`d-${row.id}`}>Due</label>
                                  <Input id={`d-${row.id}`} name="dueAt" type="date" />
                                </div>
                              </div>
                            </ActionForm>
                          ) : (
                            <p className="text-2xs text-ink-muted">This client has no open project to put a task in. Create one in Projects first.</p>
                          )
                        ) : null}
                        <div className="space-y-3">
                          {!closed ? (
                            <ActionForm action={assignOpportunityAction} label="Assign" variant="secondary" hidden={{ opportunityId: row.id }} className="flex flex-wrap items-end gap-2">
                              <label className="sr-only" htmlFor={`as-${row.id}`}>Assignee</label>
                              <Select id={`as-${row.id}`} name="assigneeId" defaultValue={row.assignee?.id ?? ""} className="w-44">
                                <option value="">Nobody</option>
                                {staff.map((user) => (
                                  <option key={user.id} value={user.id}>{user.name}</option>
                                ))}
                              </Select>
                            </ActionForm>
                          ) : null}
                          {!closed ? <ActionForm action={doneOpportunityAction} label="Mark done" variant="secondary" hidden={{ opportunityId: row.id }} /> : null}
                          {!closed ? (
                            <ActionForm action={dismissOpportunityAction} label="Dismiss" variant="secondary" hidden={{ opportunityId: row.id }} className="flex flex-wrap items-end gap-2">
                              <label className="sr-only" htmlFor={`r-${row.id}`}>Reason</label>
                              <Input id={`r-${row.id}`} name="reason" placeholder="Why (optional)" maxLength={500} className="w-52" />
                            </ActionForm>
                          ) : (
                            <ActionForm action={reopenOpportunityAction} label="Reopen" variant="secondary" hidden={{ opportunityId: row.id }} />
                          )}
                        </div>
                      </div>
                    </details>
                  ) : null}
                </CardBody>
              </Card>
            );
          })}
          <Pagination
            basePath="/admin/marketing/seo/command"
            params={{ property: property?.id, status: params.status === "active" ? undefined : params.status, source: params.source, severity: params.severity, effort: params.effort, assignee: params.assignee, q: params.q }}
            page={result.list.page}
            pages={result.list.pages}
            total={result.list.total}
            perPage={PAGE_SIZE}
          />
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Open by website</CardTitle>
            </CardHeader>
            <CardBody>
              {sites.length === 0 ? (
                <p className="text-xs text-ink-subtle">No open opportunities.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {sites.map((site) => (
                    <li key={site.id} className="py-2">
                      <Link href={link({ property: site.id, page: undefined })} className="block truncate text-sm text-navy-800 hover:text-brand-red">
                        {site.client.name} — {site.displayName}
                      </Link>
                      <p className="text-2xs tabular-nums text-ink-subtle">
                        {site.counts.HIGH} high · {site.counts.MEDIUM} medium · {site.counts.LOW} low
                        {site.lastDetectedAt ? ` · checked ${DATE_TIME.format(site.lastDetectedAt)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          {canManage && property ? (
            <Card>
              <CardBody className="space-y-2">
                <p className="text-xs text-ink-muted">Detection runs daily. Run it now for {property.displayName} after fixing something or changing thresholds.</p>
                <ActionForm action={detectNowAction} label="Detect now" pendingLabel="Detecting…" variant="secondary" hidden={{ propertyId: property.id }} />
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardBody className="space-y-2 text-2xs text-ink-muted">
              <p>
                <span className="font-medium text-navy-800">Severity.</span> Click findings are high from {CLICK_SEVERITY.high} clicks and medium from {CLICK_SEVERITY.medium}; critical technical issues and indexable pages Google has not indexed are high. Impacts are calculated by Emporia from Search Console and the crawl.
              </p>
              <p>A dismissed finding comes back only if its impact doubles.</p>
              <p>
                <Link href={`/admin/marketing/seo/settings/thresholds${property ? `?property=${property.id}` : ""}` as Route} className="text-navy-800 underline underline-offset-2">
                  Thresholds
                </Link>{" "}
                decide what counts as a finding.
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}
