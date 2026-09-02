import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { getProject } from "@/lib/services/portal.service";
import { isAppError } from "@/lib/errors";
import { HEALTH_LABEL } from "@/lib/projects/health";
import {
  MILESTONE_STATUS_LABEL,
  PROJECT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  isTaskClosed,
} from "@/lib/projects/lifecycle";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Project" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function PortalProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const actor = await requirePortalActorPage();

  let project;
  try {
    project = await getProject(actor, projectId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const done = project.tasks.filter((task) => isTaskClosed(task.status)).length;
  const progress = project.tasks.length === 0 ? null : Math.round((done / project.tasks.length) * 100);

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/portal/projects" className="hover:text-navy-800">
            Projects
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">{project.name}</span>
        </nav>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl text-navy-800">{project.name}</h1>
          <Badge tone="neutral">{PROJECT_STATUS_LABEL[project.status]}</Badge>
          <Badge
            tone={
              project.health === "ON_TRACK"
                ? "success"
                : project.health === "AT_RISK"
                  ? "warning"
                  : "red"
            }
          >
            {HEALTH_LABEL[project.health]}
          </Badge>
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          {[
            project.service?.name,
            `led by ${project.manager.name}`,
            `started ${DATE.format(project.startsAt)}`,
            project.dueAt ? `due ${DATE.format(project.dueAt)}` : null,
            progress !== null ? `${progress}% complete` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardHeader>
            <CardTitle>Work</CardTitle>
          </CardHeader>
          <CardBody>
            {project.tasks.length === 0 ? (
              <p className="text-xs text-ink-subtle">Nothing scheduled yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {project.tasks
                  .filter((task) => !task.parentId)
                  .map((task) => (
                    <li key={task.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-navy-800">{task.title}</p>
                        <p className="text-2xs text-ink-subtle">
                          {[
                            task.milestone?.title,
                            task.dueAt ? `due ${DATE.format(task.dueAt)}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>
                      </div>
                      <Badge
                        tone={
                          task.status === "DONE"
                            ? "success"
                            : task.status === "BLOCKED"
                              ? "red"
                              : "neutral"
                        }
                      >
                        {TASK_STATUS_LABEL[task.status]}
                      </Badge>
                    </li>
                  ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Milestones</CardTitle>
          </CardHeader>
          <CardBody>
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
                    <Badge
                      tone={milestone.status === "COMPLETED" ? "success" : "neutral"}
                      className="mt-1"
                    >
                      {MILESTONE_STATUS_LABEL[milestone.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
