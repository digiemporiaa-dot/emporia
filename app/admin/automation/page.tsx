import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listAutomations, recentRuns } from "@/lib/services/automation.service";
import { TRIGGER_LABEL } from "@/lib/automation/types";
import { ACTION_LABEL } from "@/lib/automation/action-labels";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { RuleToggle } from "./rule-controls";
import type { ActionConfig } from "@/lib/validation/automation";

export const metadata: Metadata = { title: "Automation" };
export const dynamic = "force-dynamic";

const WHEN = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export default async function AutomationPage() {
  const actor = await requireActorPage("/admin/automation");
  requirePermission(actor, "automation.view");

  const [rules, runs] = await Promise.all([listAutomations(actor), recentRuns(actor, 25)]);
  const editable = can(actor, "automation.edit");

  return (
    <>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">
            Automation
          </p>
          <h1 className="mt-1.5 text-2xl text-navy-800">Rules</h1>
          <p className="mt-1.5 text-xs text-ink-subtle">
            Trigger, conditions, actions — stored in the database and edited here. Changing one
            takes effect on the next event; nothing needs deploying.
          </p>
        </div>
        {editable ? (
          <Link href="/admin/automation/new">
            <Button size="sm">New rule</Button>
          </Link>
        ) : null}
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-3">
          {rules.length === 0 ? (
            <Card>
              <CardBody className="py-10 text-center">
                <p className="text-sm font-medium text-navy-800">No rules yet</p>
                <p className="mx-auto mt-1.5 max-w-md text-xs text-ink-subtle">
                  A rule watches for something happening, checks whatever conditions you set, and
                  then does the follow-up work nobody should have to remember.
                </p>
              </CardBody>
            </Card>
          ) : (
            rules.map((rule) => (
              <Card key={rule.id}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/automation/${rule.id}`}
                          className="font-display text-lg text-navy-800 hover:text-brand-red"
                        >
                          {rule.name}
                        </Link>
                        <Badge tone={rule.isActive ? "success" : "neutral"}>
                          {rule.isActive ? "on" : "off"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-ink-muted">
                        {rule.trigger ? TRIGGER_LABEL[rule.trigger] : "No trigger set"}
                        {rule._count.conditions > 0
                          ? ` · ${rule._count.conditions} condition${rule._count.conditions === 1 ? "" : "s"}`
                          : " · every time"}
                        {` · ${rule._count.actions} action${rule._count.actions === 1 ? "" : "s"}`}
                      </p>
                      {rule.description ? (
                        <p className="mt-1.5 text-xs text-ink-subtle">{rule.description}</p>
                      ) : null}
                    </div>
                    {editable ? <RuleToggle id={rule.id} isActive={rule.isActive} /> : null}
                  </div>
                </CardBody>
              </Card>
            ))
          )}
        </div>

        <aside>
          <Card>
            <CardHeader>
              <CardTitle>What the rules have done</CardTitle>
              <p className="text-xs text-ink-subtle">
                Read from the audit trail, so this is the record rather than a copy of it.
              </p>
            </CardHeader>
            <CardBody>
              {runs.length === 0 ? (
                <p className="text-xs text-ink-subtle">Nothing has run yet.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {runs.map((run) => (
                    <li key={run.id} className="py-2.5">
                      <p className="text-xs text-navy-800">{run.name}</p>
                      <p className="text-2xs text-ink-subtle">
                        {run.trigger ? TRIGGER_LABEL[run.trigger as keyof typeof TRIGGER_LABEL] : "—"}
                        {" · "}
                        {WHEN.format(run.at)}
                      </p>
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
        </aside>
      </div>
    </>
  );
}
