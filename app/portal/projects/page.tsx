import type { Metadata } from "next";
import Link from "next/link";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { listProjects } from "@/lib/services/portal.service";
import { HEALTH_LABEL } from "@/lib/projects/health";
import { PROJECT_STATUS_LABEL } from "@/lib/projects/lifecycle";
import { Badge, Card, CardBody } from "@/components/ui";

export const metadata: Metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function PortalProjectsPage() {
  const actor = await requirePortalActorPage();
  const projects = await listProjects(actor);

  return (
    <>
      <header className="mb-5">
        <h1 className="text-2xl text-navy-800">Projects</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">Everything we are delivering for you.</p>
      </header>

      {projects.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-ink-subtle">No projects yet.</p>
          </CardBody>
        </Card>
      ) : (
        <ul className="space-y-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Card className="transition-colors hover:border-navy-300">
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/portal/projects/${project.id}`}
                        className="font-display text-base text-navy-800 hover:text-brand-red"
                      >
                        {project.name}
                      </Link>
                      <p className="mt-0.5 text-2xs text-ink-subtle">
                        {[
                          project.service?.name,
                          `${project._count.tasks} task${project._count.tasks === 1 ? "" : "s"}`,
                          project.dueAt ? `due ${DATE.format(project.dueAt)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
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
                    </span>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
