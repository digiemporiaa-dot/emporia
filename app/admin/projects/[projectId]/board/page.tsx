import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { getProject, listTasks } from "@/lib/services/project.service";
import { isAppError } from "@/lib/errors";
import { isTaskClosed } from "@/lib/projects/lifecycle";
import { Button } from "@/components/ui";
import { TaskBoard } from "./board";

export const metadata: Metadata = { title: "Task board" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });

export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const actor = await requireActorPage("/admin/projects");
  requirePermission(actor, "tasks.view");

  let project;
  try {
    project = await getProject(actor, projectId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const tasks = await listTasks(actor, { projectId });

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/projects" className="hover:text-navy-800">
              Projects
            </Link>
            <span aria-hidden="true"> / </span>
            <Link href={`/admin/projects/${project.id}`} className="hover:text-navy-800">
              {project.code}
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Board</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">{project.name}</h1>
        </div>
        <Link href={`/admin/projects/${project.id}`}>
          <Button variant="secondary" size="sm">
            Project detail
          </Button>
        </Link>
      </header>

      <TaskBoard
        canMove={can(actor, "tasks.edit")}
        tasks={tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          // Dates are formatted on the server; a Date would not survive the
          // boundary and the client would format it in another timezone.
          dueAt: task.dueAt ? DATE.format(task.dueAt) : null,
          assignee: task.assignee,
          waitingOn: task.dependencies
            .filter((dependency) => !isTaskClosed(dependency.dependsOn.status))
            .map((dependency) => dependency.dependsOn.title),
        }))}
      />
    </>
  );
}
