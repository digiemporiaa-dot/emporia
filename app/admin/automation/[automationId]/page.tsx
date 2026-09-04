import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getAutomation, recentRuns } from "@/lib/services/automation.service";
import { isAppError } from "@/lib/errors";
import { TRIGGER_LABEL } from "@/lib/automation/types";
import { ACTION_LABEL } from "@/lib/automation/action-labels";
import { ROLE_NAMES } from "@/lib/auth/permissions";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { AutomationEditor, type AutomationValues } from "../automation-editor";
import { DeleteRule, PreviewRule, RuleToggle } from "../rule-controls";
import type { ActionConfig } from "@/lib/validation/automation";
import type { Operator } from "@/lib/automation/conditions";

export const metadata: Metadata = { title: "Rule" };
export const dynamic = "force-dynamic";

const WHEN = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export default async function AutomationDetailPage({
  params,
}: {
  params: Promise<{ automationId: string }>;
}) {
  const { automationId } = await params;
  const actor = await requireActorPage("/admin/automation");
  requirePermission(actor, "automation.view");

  let automation;
  try {
    automation = await getAutomation(actor, automationId);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const editable = can(actor, "automation.edit");

  const [staff, runs] = await Promise.all([
    editable
      ? db.user.findMany({
          where: { type: "STAFF", status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    recentRuns(actor, 25, automationId),
  ]);

  const values: AutomationValues | undefined = automation.trigger
    ? {
        id: automation.id,
        name: automation.name,
        description: automation.description,
        isActive: automation.isActive,
        order: automation.order,
        trigger: automation.trigger,
        conditions: automation.conditions.map((condition) => ({
          field: condition.field,
          operator: condition.operator as Operator,
          value: condition.value === null ? "" : String(condition.value),
        })),
        actions: automation.actions.map((action) => ({
          ...(action.config as Record<string, unknown>),
          type: action.type,
        })),
      }
    : undefined;

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/automation" className="hover:text-navy-800">
              Automation
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">{automation.name}</span>
          </nav>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl text-navy-800">{automation.name}</h1>
            <Badge tone={automation.isActive ? "success" : "neutral"}>
              {automation.isActive ? "on" : "off"}
            </Badge>
          </div>
          <p className="mt-1.5 text-xs text-ink-subtle">
            {automation.trigger ? TRIGGER_LABEL[automation.trigger] : "No trigger set"}
          </p>
        </div>
        {editable ? <RuleToggle id={automation.id} isActive={automation.isActive} /> : null}
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0">
          {editable && values ? (
            <AutomationEditor automation={values} staff={staff} roles={ROLE_NAMES} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>What this rule does</CardTitle>
              </CardHeader>
              <CardBody>
                <ol className="space-y-1.5 text-sm text-ink-muted">
                  {automation.actions.map((action) => (
                    <li key={action.id}>
                      {ACTION_LABEL[action.type as ActionConfig["type"]] ?? action.type}
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Try it</CardTitle>
            </CardHeader>
            <CardBody>
              <PreviewRule id={automation.id} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>What it has done</CardTitle>
            </CardHeader>
            <CardBody>
              {runs.length === 0 ? (
                <p className="text-xs text-ink-subtle">This rule has not run yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {runs.map((run) => (
                    <li key={run.id} className="py-2.5">
                      <p className="text-2xs text-ink-subtle">{WHEN.format(run.at)}</p>
                      <ul className="mt-1 space-y-0.5">
                        {run.actions.map((action, index) => (
                          <li
                            key={index}
                            className={`text-2xs ${action.changed ? "text-ink-muted" : "text-ink-subtle"}`}
                          >
                            {ACTION_LABEL[action.type as ActionConfig["type"]] ?? action.type}:{" "}
                            {action.detail}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {editable && !automation.isActive ? (
            <Card>
              <CardBody>
                <DeleteRule id={automation.id} />
              </CardBody>
            </Card>
          ) : null}
        </aside>
      </div>
    </>
  );
}
