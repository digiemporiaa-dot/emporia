import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import {
  getProject,
  healthDetail,
  listComments,
  listTasks,
  projectTime,
} from "@/lib/services/project.service";
import { isAppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { MILESTONE_STATUS_LABEL } from "@/lib/projects/lifecycle";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { HealthBadge, ProjectStatusBadge } from "../project-badges";
import {
  CommentPanel,
  MilestoneForm,
  MilestoneStatusControl,
  ProjectStatusControl,
  TaskForm,
  TaskList,
  TimePanel,
} from "./project-panels";

export const metadata: Metadata = { title: "Project" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const actor = await requireActorPage("/admin/projects");

  let project;
  try {
    project = await getProject(actor, projectId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const canSeeTime = can(actor, "timeentries.view");

  const [tasks, health, comments, time, staff] = await Promise.all([
    can(actor, "tasks.view") ? listTasks(actor, { projectId }) : Promise.resolve([]),
    healthDetail(actor, projectId),
    listComments(actor, projectId),
    canSeeTime
      ? projectTime(actor, projectId)
      : Promise.resolve({ totalMinutes: 0, byUser: [], recent: [] }),
    can(actor, "tasks.assign")
      ? db.user.findMany({
          where: { type: "STAFF", status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const canEditTasks = can(actor, "tasks.edit");
  const canCreateTasks = can(actor, "tasks.create");
  const topLevel = tasks.filter((task) => !task.parentId).map((t) => ({ id: t.id, title: t.title }));

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/projects" className="hover:text-navy-800">
            Projects
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{project.code}</span>
        </nav>

        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{project.name}</h1>
          <ProjectStatusBadge status={project.status} />
          <HealthBadge health={project.health} />
        </div>

        <p className="mt-1.5 text-xs text-ink-subtle">
          <span className="font-mono">{project.code}</span> ·{" "}
          <Link href={`/admin/clients/${project.client.id}`} className="hover:text-brand-red">
            {project.client.name}
          </Link>
          {project.service ? ` · ${project.service.name}` : ""} · {health.reason}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/admin/projects/${project.id}/board`}>
            <Button variant="secondary" size="sm">
              Task board
            </Button>
          </Link>
          <Link href={`/admin/content?projectId=${project.id}`}>
            <Button variant="secondary" size="sm">
              Content calendar
            </Button>
          </Link>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Tasks</CardTitle>
              {canCreateTasks ? (
                <TaskForm
                  projectId={project.id}
                  staff={staff}
                  milestones={project.milestones.map((m) => ({ id: m.id, title: m.title }))}
                  parents={topLevel}
                  canAssign={can(actor, "tasks.assign")}
                />
              ) : null}
            </CardHeader>
            <CardBody>
              <TaskList
                tasks={tasks.map((task) => ({
                  id: task.id,
                  parentId: task.parentId,
                  title: task.title,
                  status: task.status,
                  priority: task.priority,
                  dueAt: task.dueAt,
                  estimateHours: task.estimateHours,
                  assignee: task.assignee,
                  milestone: task.milestone,
                  dependencies: task.dependencies,
                  _count: task._count,
                }))}
                canEdit={canEditTasks}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Discussion</CardTitle>
            </CardHeader>
            <CardBody>
              <CommentPanel projectId={project.id} comments={comments} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Detail</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <dl className="space-y-2.5 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-ink-subtle">Budget</dt>
                  <dd className="tabular-nums text-navy-800">
                    {formatMoney(project.budget, project.currency)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-ink-subtle">Manager</dt>
                  <dd className="text-navy-800">{project.manager.name}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-ink-subtle">Starts</dt>
                  <dd className="text-navy-800">{DATE.format(project.startsAt)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-ink-subtle">Due</dt>
                  <dd className="text-navy-800">
                    {project.dueAt ? DATE.format(project.dueAt) : "—"}
                  </dd>
                </div>
                {project.completedAt ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-xs text-ink-subtle">Completed</dt>
                    <dd className="text-navy-800">{DATE.format(project.completedAt)}</dd>
                  </div>
                ) : null}
                {project.contract ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-xs text-ink-subtle">Contract</dt>
                    <dd>
                      <Link
                        href={`/admin/sales/contracts/${project.contract.id}`}
                        className="font-mono text-xs text-navy-800 hover:text-brand-red-text"
                      >
                        {project.contract.number}
                      </Link>
                    </dd>
                  </div>
                ) : null}
                {health.progress !== null ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-xs text-ink-subtle">Progress</dt>
                    <dd className="tabular-nums text-navy-800">
                      {health.progress}%{" "}
                      <span className="text-xs text-ink-subtle">
                        ({health.closedTasks}/{health.closedTasks + health.openTasks})
                      </span>
                    </dd>
                  </div>
                ) : null}
              </dl>

              {can(actor, "projects.edit") ? (
                <ProjectStatusControl projectId={project.id} status={project.status} />
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Milestones</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {project.milestones.length === 0 ? (
                <p className="text-xs text-ink-subtle">No milestones set.</p>
              ) : (
                <ul className="space-y-3">
                  {project.milestones.map((milestone) => (
                    <li key={milestone.id}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm text-navy-800">{milestone.title}</p>
                        <span className="shrink-0 text-2xs text-ink-subtle">
                          {DATE.format(milestone.dueAt)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        {can(actor, "projects.edit") ? (
                          <MilestoneStatusControl projectId={project.id} milestone={milestone} />
                        ) : (
                          <Badge tone="neutral">{MILESTONE_STATUS_LABEL[milestone.status]}</Badge>
                        )}
                        <span className="text-2xs text-ink-subtle">
                          {milestone._count.tasks} task{milestone._count.tasks === 1 ? "" : "s"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {can(actor, "projects.edit") ? (
                <div className="border-t border-line pt-3">
                  <MilestoneForm projectId={project.id} />
                </div>
              ) : null}
            </CardBody>
          </Card>

          {canSeeTime ? (
            <Card>
              <CardHeader>
                <CardTitle>Time</CardTitle>
              </CardHeader>
              <CardBody>
                <TimePanel
                  projectId={project.id}
                  tasks={tasks.map((task) => ({ id: task.id, title: task.title }))}
                  totalMinutes={time.totalMinutes}
                  byUser={time.byUser}
                  recent={time.recent}
                  canLog={can(actor, "timeentries.create")}
                />
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
