import type { Metadata } from "next";
import Link from "next/link";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { dashboard } from "@/lib/services/portal.service";
import { myOnboardingProgress } from "@/lib/services/onboarding.service";
import { globals } from "@/lib/services/email.service";
import { formatMoney } from "@/lib/money";
import { HEALTH_LABEL } from "@/lib/projects/health";
import { PROJECT_STATUS_LABEL } from "@/lib/projects/lifecycle";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function PortalHome() {
  const actor = await requirePortalActorPage();
  const [data, setup, site] = await Promise.all([dashboard(actor), myOnboardingProgress(actor), globals()]);

  const stats = [
    {
      label: "Waiting on you",
      value: String(data.openApprovals),
      detail: data.openApprovals === 1 ? "approval" : "approvals",
      href: "/portal/approvals" as const,
    },
    {
      label: "In review",
      value: String(data.contentAwaitingReview),
      detail: "content items",
      href: "/portal/content" as const,
    },
    {
      label: "Outstanding",
      value: formatMoney(data.outstandingTotal, "INR"),
      detail: `${data.outstandingInvoices} invoice${data.outstandingInvoices === 1 ? "" : "s"}`,
      href: "/portal/invoices" as const,
    },
    {
      label: "Unread",
      value: String(data.unreadMessages),
      detail: data.unreadMessages === 1 ? "message" : "messages",
      href: "/portal/messages" as const,
    },
  ];

  return (
    <>
      <header className="mb-6">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">
          {data.client.name}
        </p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Your account</h1>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Working with us since {DATE.format(data.client.createdAt)}.
        </p>
      </header>

      {!setup.complete ? (
        <Card className="mb-5">
          <CardBody className="space-y-4">
            <div>
              <h2 className="font-display text-xl text-navy-800">Welcome to {site.siteName} 👋</h2>
              <p className="mt-1 text-sm text-ink-muted">Let&apos;s get your account ready.</p>
            </div>
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {setup.steps
                .filter((step) => step.state !== "not-applicable")
                .map((step) => (
                  <li key={step.step} className="flex items-center gap-2 text-sm">
                    <span aria-hidden="true" className={step.state === "done" ? "text-success" : "text-ink-subtle"}>
                      {step.state === "done" ? "✓" : "○"}
                    </span>
                    <span className={step.state === "done" ? "text-navy-800" : "text-ink-muted"}>{step.label}</span>
                    <span className="sr-only">{step.state === "done" ? "(done)" : "(to do)"}</span>
                  </li>
                ))}
            </ul>
            <div>
              <div className="flex items-baseline justify-between text-xs text-ink-muted">
                <span>Account setup</span>
                <span className="font-medium tabular-nums text-navy-800">{setup.percent}%</span>
              </div>
              <div
                role="progressbar"
                aria-label="Account setup"
                aria-valuenow={setup.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-1 h-2 overflow-hidden rounded-full bg-surface-sunken"
              >
                <div className="h-full rounded-full bg-navy-700" style={{ width: `${setup.percent}%` }} />
              </div>
            </div>
            <Link href="/portal/onboarding" className="inline-flex items-center rounded-md bg-brand-red px-3.5 py-2 text-sm font-medium text-white hover:bg-red-600">
              Continue setup
            </Link>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="group">
            <Card className="h-full transition-colors group-hover:border-navy-300">
              <CardBody>
                <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
                  {stat.label}
                </p>
                <p className="mt-1.5 font-display text-2xl tabular-nums text-navy-800 group-hover:text-brand-red">
                  {stat.value}
                </p>
                <p className="text-xs text-ink-subtle">{stat.detail}</p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Projects</CardTitle>
        </CardHeader>
        <CardBody>
          {data.projects.length === 0 ? (
            <p className="text-xs text-ink-subtle">
              Nothing is in delivery yet. Your account manager will start a project once work is
              agreed.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {data.projects.map((project) => (
                <li key={project.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/portal/projects/${project.id}`}
                      className="text-sm text-navy-800 hover:text-brand-red-text"
                    >
                      {project.name}
                    </Link>
                    <p className="text-2xs text-ink-subtle">
                      {project._count.tasks} task{project._count.tasks === 1 ? "" : "s"}
                      {project.dueAt ? ` · due ${DATE.format(project.dueAt)}` : ""}
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
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
