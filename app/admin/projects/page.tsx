import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { listProjects, seesWholeTeam } from "@/lib/services/project.service";
import { projectListParamsSchema } from "@/lib/validation/project";
import { formatMoney } from "@/lib/money";
import { Button, Table, TableEmpty, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui";
import { ProjectFilters } from "./project-filters";
import { HealthBadge, ProjectStatusBadge } from "./project-badges";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireActorPage("/admin/projects");
  const raw = await searchParams;

  // Query-string filters are validated like any other input; anything
  // unrecognised falls back to the default rather than reaching the query.
  const parsed = projectListParamsSchema.safeParse(raw);
  const params = parsed.success ? parsed.data : projectListParamsSchema.parse({});

  const [result, clients, staff] = await Promise.all([
    listProjects(actor, params),
    db.client.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    seesWholeTeam(actor)
      ? db.user.findMany({
          where: { type: "STAFF", status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const from = result.total === 0 ? 0 : (result.page - 1) * result.perPage + 1;
  const to = Math.min(result.page * result.perPage, result.total);

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">Delivery</p>
          <h1 className="mt-1.5 text-2xl text-navy-800">Projects</h1>
          <p className="mt-1.5 text-xs text-ink-subtle">
            {seesWholeTeam(actor)
              ? "Showing every project."
              : "Showing the projects you manage or have tasks on."}
          </p>
        </div>
        {can(actor, "projects.create") ? (
          <Link href="/admin/projects/new">
            <Button size="sm">New project</Button>
          </Link>
        ) : null}
      </header>

      <ProjectFilters params={params} clients={clients} staff={staff} />

      <div className="mt-4">
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Project</TH>
                <TH>Client</TH>
                <TH>Status</TH>
                <TH>Health</TH>
                <TH className="text-right">Budget</TH>
                <TH className="text-right">Tasks</TH>
                <TH>Manager</TH>
                <TH>Due</TH>
              </TR>
            </THead>
            <TBody>
              {result.rows.length === 0 ? (
                <TableEmpty
                  colSpan={8}
                  title="No projects match"
                  description={
                    result.total === 0 && !params.search
                      ? "Start one against a client you have won."
                      : "Try widening the filters."
                  }
                />
              ) : (
                result.rows.map((project) => (
                  <TR key={project.id}>
                    <TD>
                      <Link
                        href={`/admin/projects/${project.id}`}
                        className="font-medium text-navy-800 hover:text-brand-red"
                      >
                        {project.name}
                      </Link>
                      <span className="block font-mono text-2xs text-ink-subtle">
                        {project.code}
                        {project.service ? ` · ${project.service.name}` : ""}
                      </span>
                    </TD>
                    <TD className="text-ink-muted">
                      <Link
                        href={`/admin/clients/${project.client.id}`}
                        className="hover:text-brand-red"
                      >
                        {project.client.name}
                      </Link>
                    </TD>
                    <TD>
                      <ProjectStatusBadge status={project.status} />
                    </TD>
                    <TD>
                      <HealthBadge health={project.health} />
                    </TD>
                    <TD className="text-right tabular-nums">
                      {formatMoney(project.budget, project.currency)}
                    </TD>
                    <TD className="text-right tabular-nums text-ink-muted">
                      {project._count.tasks}
                    </TD>
                    <TD className="text-xs text-ink-muted">{project.manager.name}</TD>
                    <TD className="text-xs text-ink-subtle">
                      {project.dueAt ? DATE.format(project.dueAt) : "—"}
                    </TD>
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
              Page {result.page} of {result.pages}
            </span>
            <PageLink params={params} page={result.page + 1} disabled={result.page >= result.pages}>
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
    return (
      <span className="rounded-sm border border-line px-2.5 py-1 text-ink-subtle/60">
        {children}
      </span>
    );
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
      href={`/admin/projects?${query.toString()}`}
      className="rounded-sm border border-line-strong px-2.5 py-1 text-navy-800 hover:border-brand-red hover:text-brand-red"
    >
      {children}
    </Link>
  );
}
