import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { db } from "@/lib/db";
import { listLeads, seesWholeTeam } from "@/lib/services/crm.service";
import { leadListParamsSchema } from "@/lib/validation/crm";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { PriorityBadge, ScoreBadge, StatusBadge } from "@/components/admin/lead-badges";
import { LeadFilters } from "./lead-filters";
import { PIPELINE_STAGES } from "@/lib/crm/pipeline";

export const metadata: Metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/leads");
  const raw = await searchParams;

  // Query-string filters are validated like any other input; anything
  // unrecognised falls back to the default rather than reaching the query.
  const parsed = leadListParamsSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : leadListParamsSchema.parse({});

  const [result, sources, services, cities, staff] = await Promise.all([
    listLeads(actor, params),
    db.leadSource.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.service.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    db.city.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true } }),
    seesWholeTeam(actor)
      ? db.user.findMany({
          where: { type: "STAFF", status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const from = (result.page - 1) * result.perPage + 1;
  const to = Math.min(result.page * result.perPage, result.total);

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">CRM</p>
          <h1 className="mt-1.5 text-2xl text-navy-800">Leads</h1>
          <p className="mt-1.5 text-xs text-ink-subtle">
            {seesWholeTeam(actor)
              ? "Showing every lead in the pipeline."
              : "Showing the leads assigned to you."}
          </p>
        </div>
        <Link href="/admin/leads/pipeline">
          <Button variant="secondary" size="sm">
            Pipeline board
          </Button>
        </Link>
      </header>

      <LeadFilters
        params={params}
        sources={sources}
        services={services}
        cities={cities}
        staff={staff}
        stages={PIPELINE_STAGES}
      />

      <div className="mt-4">
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Lead</TH>
                <TH>Source</TH>
                <TH>Interest</TH>
                <TH className="text-right">Budget</TH>
                <TH className="text-right">Score</TH>
                <TH>Priority</TH>
                <TH>Status</TH>
                <TH>Owner</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {result.rows.length === 0 ? (
                <TableEmpty
                  colSpan={9}
                  title="No leads match"
                  description={
                    result.total === 0 && !params.search
                      ? "Leads appear here as the website captures them."
                      : "Try widening the filters."
                  }
                />
              ) : (
                result.rows.map((lead) => (
                  <TR key={lead.id}>
                    <TD>
                      <Link
                        href={`/admin/leads/${lead.id}`}
                        className="font-medium text-navy-800 hover:text-brand-red"
                      >
                        {lead.name}
                      </Link>
                      <span className="block text-xs text-ink-subtle">
                        {lead.company ?? lead.email ?? lead.phone ?? "—"}
                      </span>
                    </TD>
                    <TD className="text-xs text-ink-muted">{lead.source.name}</TD>
                    <TD className="text-xs text-ink-muted">
                      {[lead.service?.name, lead.city?.name].filter(Boolean).join(" · ") || "—"}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {lead.budget ? formatMoney(lead.budget, lead.currency) : "—"}
                    </TD>
                    <TD className="text-right">
                      <ScoreBadge score={lead.score} />
                    </TD>
                    <TD>
                      <PriorityBadge priority={lead.priority} />
                    </TD>
                    <TD>
                      <StatusBadge status={lead.status} />
                    </TD>
                    <TD className="text-xs text-ink-muted">
                      {lead.assignedTo?.name ?? <Badge tone="warning">Unassigned</Badge>}
                    </TD>
                    <TD className="text-xs text-ink-subtle">{DATE.format(lead.createdAt)}</TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableWrap>
      </div>

      {result.total > 0 ? (
        <nav
          aria-label="Pagination"
          className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-subtle"
        >
          <p>
            Showing {from}–{to} of {result.total}
          </p>
          <div className="flex items-center gap-2">
            <PageLink params={params} page={result.page - 1} disabled={result.page <= 1}>
              Previous
            </PageLink>
            <span className="tabular-nums">
              Page {result.page} of {result.pageCount}
            </span>
            <PageLink
              params={params}
              page={result.page + 1}
              disabled={result.page >= result.pageCount}
            >
              Next
            </PageLink>
          </div>
        </nav>
      ) : null}
    </>
  );
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: Record<string, unknown>;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="rounded-sm border border-line px-2.5 py-1 text-ink-subtle/60">{children}</span>;
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "" && key !== "page") {
      query.set(key, String(value));
    }
  }
  query.set("page", String(page));

  return (
    <Link
      href={`/admin/leads?${query.toString()}`}
      className="rounded-sm border border-line-strong px-2.5 py-1 text-navy-800 hover:border-brand-red hover:text-brand-red"
    >
      {children}
    </Link>
  );
}
