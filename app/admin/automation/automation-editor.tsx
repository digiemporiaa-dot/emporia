"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import {
  OPERATOR_LABEL,
  OPERATORS,
  UNARY_OPERATORS,
  type Operator,
} from "@/lib/automation/conditions";
import { TRIGGER_FACTS, TRIGGER_LABEL, WIRED_TRIGGERS, type WiredTrigger } from "@/lib/automation/types";
import { ACTION_LABEL } from "@/lib/automation/action-labels";
import { saveAutomationAction, type AutomationActionState } from "./actions";

/**
 * The rule editor.
 *
 * The condition field list comes from `TRIGGER_FACTS`, so a condition can only
 * be written against a fact the chosen trigger actually provides — the reason
 * changing the trigger clears the conditions. Action settings are per type, and
 * the whole rule is submitted as one JSON payload the server re-validates.
 */

type Condition = { field: string; operator: Operator; value: string };

// The editor keeps action config loose and lets the server's discriminated
// union be the judge; anything it cannot parse is refused with a message.
type Action = { type: string } & Record<string, unknown>;

export type AutomationValues = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  order: number;
  trigger: WiredTrigger;
  conditions: Condition[];
  actions: Action[];
};

const ACTION_TYPES = Object.keys(ACTION_LABEL) as (keyof typeof ACTION_LABEL)[];

const DEFAULT_ACTION: Record<string, Action> = {
  ASSIGN_LEAD: { type: "ASSIGN_LEAD", strategy: "ROUND_ROBIN", onlyIfUnassigned: true },
  CREATE_LEAD_TASK: { type: "CREATE_LEAD_TASK", title: "Follow up", dueInDays: 1, assignTo: "LEAD_OWNER", priority: "MEDIUM" },
  SEND_EMAIL: { type: "SEND_EMAIL", templateKey: "FOLLOW_UP", to: "LEAD_OWNER" },
  NOTIFY_USER: { type: "NOTIFY_USER", to: "LEAD_OWNER", title: "Something happened" },
  CREATE_CLIENT: { type: "CREATE_CLIENT" },
  CREATE_PROJECT: { type: "CREATE_PROJECT", nameTemplate: "{{client.name}} onboarding", startInDays: 0 },
  CREATE_PROJECT_TASKS: { type: "CREATE_PROJECT_TASKS", titles: ["Kick-off call"], dueInDays: 7 },
  SET_LEAD_STATUS: { type: "SET_LEAD_STATUS", status: "CONTACTED" },
  ADD_TAG: { type: "ADD_TAG", tagName: "Tag" },
};

const TEMPLATE_KEYS = [
  "NEW_LEAD",
  "LEAD_ASSIGNED",
  "FOLLOW_UP",
  "PROPOSAL_SENT",
  "PROPOSAL_ACCEPTED",
  "INVOICE_SENT",
  "PAYMENT_RECEIVED",
  "PAYMENT_REMINDER",
  "CLIENT_NOTIFICATION",
] as const;

const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "PROPOSAL",
  "NEGOTIATION",
  "LOST",
  "NURTURE",
] as const;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

const cell =
  "h-9 w-full rounded-sm border border-line bg-white px-2 text-sm text-ink focus:border-brand-red";

export function AutomationEditor({
  automation,
  staff,
  roles,
}: {
  automation?: AutomationValues;
  staff: readonly { id: string; name: string }[];
  roles: readonly string[];
}) {
  const [state, formAction] = useActionState<AutomationActionState, FormData>(
    saveAutomationAction,
    null,
  );

  const [name, setName] = React.useState(automation?.name ?? "");
  const [description, setDescription] = React.useState(automation?.description ?? "");
  const [isActive, setIsActive] = React.useState(automation?.isActive ?? false);
  const [order, setOrder] = React.useState(String(automation?.order ?? 0));
  const [trigger, setTrigger] = React.useState<WiredTrigger>(automation?.trigger ?? "LEAD_CREATED");
  const [conditions, setConditions] = React.useState<Condition[]>(automation?.conditions ?? []);
  const [actions, setActions] = React.useState<Action[]>(
    automation?.actions ?? [DEFAULT_ACTION["ADD_TAG"] as Action],
  );

  const fields = TRIGGER_FACTS[trigger];

  const changeTrigger = (next: WiredTrigger) => {
    setTrigger(next);
    // A condition written against the old trigger's facts would silently never
    // match, so they go rather than lingering as a trap.
    setConditions([]);
  };

  const setCondition = (index: number, patch: Partial<Condition>) =>
    setConditions((current) =>
      current.map((condition, i) => (i === index ? { ...condition, ...patch } : condition)),
    );

  const setAction = (index: number, patch: Record<string, unknown>) =>
    setActions((current) =>
      current.map((action, i) => (i === index ? { ...action, ...patch } : action)),
    );

  const payload = {
    name,
    description: description || null,
    isActive,
    order: Number(order) || 0,
    trigger,
    conditions: conditions
      .filter((condition) => condition.field)
      .map((condition) => ({
        field: condition.field,
        operator: condition.operator,
        value: UNARY_OPERATORS.includes(condition.operator) ? null : condition.value,
      })),
    actions,
  };

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {automation ? <input type="hidden" name="id" value={automation.id} /> : null}
      <input type="hidden" name="rule" value={JSON.stringify(payload)} />

      {state && !state.ok ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
        >
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      ) : null}

      {state?.ok ? (
        <div
          role="status"
          className="rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
        >
          Saved.{" "}
          {automation ? null : (
            <Link
              href={`/admin/automation/${state.data.id}`}
              className="font-medium underline underline-offset-2"
            >
              Open it
            </Link>
          )}
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="name" label="Name" required>
          {(aria) => (
            <Input
              {...aria}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Chase every enquiry within a day"
              maxLength={160}
              required
            />
          )}
        </Field>

        <Field id="trigger" label="When" required>
          {(aria) => (
            <Select
              {...aria}
              value={trigger}
              onChange={(event) => changeTrigger(event.target.value as WiredTrigger)}
            >
              {WIRED_TRIGGERS.map((option) => (
                <option key={option} value={option}>
                  {TRIGGER_LABEL[option]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="order" label="Order" hint="Lower runs first">
          {(aria) => (
            <Input
              {...aria}
              value={order}
              onChange={(event) => setOrder(event.target.value)}
              inputMode="numeric"
            />
          )}
        </Field>

        <div className="flex items-end">
          <label className="flex h-9 items-center gap-2 text-sm text-navy-800">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              className="accent-brand-red"
            />
            Switched on
          </label>
        </div>
      </div>

      <Field id="description" label="What it is for" hint="So the next person knows why it exists">
        {(aria) => (
          <Textarea
            {...aria}
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={1000}
          />
        )}
      </Field>

      {/* ── Conditions ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-lg text-navy-800">Only when</h2>
        <p className="mt-1 text-xs text-ink-subtle">
          Every condition must hold. Leave this empty to run on every {TRIGGER_LABEL[trigger].toLowerCase()}.
        </p>

        <div className="mt-3 space-y-2">
          {conditions.map((condition, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`condition-${index}-field`}>
                Condition {index + 1} field
              </label>
              <select
                id={`condition-${index}-field`}
                className={`${cell} max-w-56`}
                value={condition.field}
                onChange={(event) => setCondition(index, { field: event.target.value })}
              >
                <option value="">Choose a field</option>
                {fields.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </select>

              <label className="sr-only" htmlFor={`condition-${index}-operator`}>
                Condition {index + 1} operator
              </label>
              <select
                id={`condition-${index}-operator`}
                className={`${cell} max-w-40`}
                value={condition.operator}
                onChange={(event) =>
                  setCondition(index, { operator: event.target.value as Operator })
                }
              >
                {OPERATORS.map((operator) => (
                  <option key={operator} value={operator}>
                    {OPERATOR_LABEL[operator]}
                  </option>
                ))}
              </select>

              {UNARY_OPERATORS.includes(condition.operator) ? null : (
                <>
                  <label className="sr-only" htmlFor={`condition-${index}-value`}>
                    Condition {index + 1} value
                  </label>
                  <input
                    id={`condition-${index}-value`}
                    className={`${cell} max-w-56`}
                    value={condition.value}
                    onChange={(event) => setCondition(index, { value: event.target.value })}
                    placeholder={
                      condition.operator === "in" || condition.operator === "not_in"
                        ? "comma, separated, values"
                        : "value"
                    }
                  />
                </>
              )}

              <button
                type="button"
                onClick={() => setConditions((c) => c.filter((_, i) => i !== index))}
                className="rounded-sm p-1 text-ink-subtle hover:bg-red-50 hover:text-brand-red"
              >
                <Trash2 size={14} aria-hidden="true" />
                <span className="sr-only">Remove condition {index + 1}</span>
              </button>
            </div>
          ))}
        </div>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() =>
            setConditions((c) => [...c, { field: "", operator: "eq", value: "" }])
          }
        >
          <Plus size={14} aria-hidden="true" className="mr-1" />
          Add a condition
        </Button>
      </section>

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-lg text-navy-800">Then</h2>
        <p className="mt-1 text-xs text-ink-subtle">
          Actions run in order. Each one checks the record first, so a rule that fires twice does not
          do the work twice.
        </p>

        <div className="mt-3 space-y-3">
          {actions.map((action, index) => (
            <div key={index} className="rounded-lg border border-line bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`action-${index}-type`}>
                  Action {index + 1}
                </label>
                <select
                  id={`action-${index}-type`}
                  className={`${cell} max-w-64`}
                  value={String(action["type"])}
                  onChange={(event) =>
                    setActions((current) =>
                      current.map((existing, i) =>
                        i === index
                          ? ((DEFAULT_ACTION[event.target.value] ?? { type: event.target.value }) as Action)
                          : existing,
                      ),
                    )
                  }
                >
                  {ACTION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {ACTION_LABEL[type]}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setActions((c) => (c.length === 1 ? c : c.filter((_, i) => i !== index)))}
                  className="rounded-sm p-1 text-ink-subtle hover:bg-red-50 hover:text-brand-red"
                >
                  <Trash2 size={14} aria-hidden="true" />
                  <span className="sr-only">Remove action {index + 1}</span>
                </button>
              </div>

              <ActionSettings
                index={index}
                action={action}
                staff={staff}
                roles={roles}
                onChange={(patch) => setAction(index, patch)}
              />
            </div>
          ))}
        </div>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() => setActions((c) => [...c, DEFAULT_ACTION["NOTIFY_USER"] as Action])}
        >
          <Plus size={14} aria-hidden="true" className="mr-1" />
          Add an action
        </Button>
      </section>

      <Submit label={automation ? "Save rule" : "Create rule"} />
    </form>
  );
}

function ActionSettings({
  index,
  action,
  staff,
  roles,
  onChange,
}: {
  index: number;
  action: Action;
  staff: readonly { id: string; name: string }[];
  roles: readonly string[];
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const id = (suffix: string) => `action-${index}-${suffix}`;
  const value = (key: string, fallback = "") =>
    action[key] === undefined || action[key] === null ? fallback : String(action[key]);

  const box = "mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3";

  switch (action["type"]) {
    case "ASSIGN_LEAD":
      return (
        <div className={box}>
          <Labelled id={id("strategy")} label="Who">
            <select
              id={id("strategy")}
              className={cell}
              value={value("strategy", "ROUND_ROBIN")}
              onChange={(event) => onChange({ strategy: event.target.value })}
            >
              <option value="ROUND_ROBIN">The least loaded rep</option>
              <option value="SPECIFIC">A specific person</option>
            </select>
          </Labelled>

          {value("strategy") === "SPECIFIC" ? (
            <Labelled id={id("userId")} label="Person">
              <select
                id={id("userId")}
                className={cell}
                value={value("userId")}
                onChange={(event) => onChange({ userId: event.target.value })}
              >
                <option value="">Choose someone</option>
                {staff.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </Labelled>
          ) : null}

          <label className="flex items-end gap-2 pb-1 text-xs text-navy-800">
            <input
              type="checkbox"
              checked={action["onlyIfUnassigned"] !== false}
              onChange={(event) => onChange({ onlyIfUnassigned: event.target.checked })}
              className="accent-brand-red"
            />
            Only if nobody owns it yet
          </label>
        </div>
      );

    case "CREATE_LEAD_TASK":
      return (
        <div className={box}>
          <Labelled id={id("title")} label="Task">
            <input
              id={id("title")}
              className={cell}
              value={value("title")}
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </Labelled>
          <Labelled id={id("dueInDays")} label="Due in (days)">
            <input
              id={id("dueInDays")}
              className={cell}
              inputMode="numeric"
              value={value("dueInDays", "1")}
              onChange={(event) => onChange({ dueInDays: event.target.value })}
            />
          </Labelled>
          <Labelled id={id("priority")} label="Priority">
            <select
              id={id("priority")}
              className={cell}
              value={value("priority", "MEDIUM")}
              onChange={(event) => onChange({ priority: event.target.value })}
            >
              {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                <option key={p} value={p}>
                  {p.toLowerCase()}
                </option>
              ))}
            </select>
          </Labelled>
        </div>
      );

    case "SEND_EMAIL":
      return (
        <div className={box}>
          <Labelled id={id("templateKey")} label="Template">
            <select
              id={id("templateKey")}
              className={cell}
              value={value("templateKey", "FOLLOW_UP")}
              onChange={(event) => onChange({ templateKey: event.target.value })}
            >
              {TEMPLATE_KEYS.map((key) => (
                <option key={key} value={key}>
                  {key.toLowerCase().replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled id={id("to")} label="To">
            <select
              id={id("to")}
              className={cell}
              value={value("to", "LEAD_OWNER")}
              onChange={(event) => onChange({ to: event.target.value })}
            >
              <option value="LEAD_OWNER">The lead&apos;s owner</option>
              <option value="LEAD">The lead</option>
              <option value="CLIENT_PRIMARY">The client&apos;s main contact</option>
              <option value="SPECIFIC">A specific address</option>
            </select>
          </Labelled>
          {value("to") === "SPECIFIC" ? (
            <Labelled id={id("email")} label="Address">
              <input
                id={id("email")}
                className={cell}
                type="email"
                value={value("email")}
                onChange={(event) => onChange({ email: event.target.value })}
              />
            </Labelled>
          ) : null}
          <Labelled id={id("subject")} label="Subject" wide>
            <input
              id={id("subject")}
              className={cell}
              value={value("subject")}
              onChange={(event) => onChange({ subject: event.target.value })}
              placeholder="Used by templates that take one"
            />
          </Labelled>
          <Labelled id={id("body")} label="Message" wide>
            <textarea
              id={id("body")}
              className={`${cell} h-auto py-1.5`}
              rows={2}
              value={value("body")}
              onChange={(event) => onChange({ body: event.target.value })}
            />
          </Labelled>
        </div>
      );

    case "NOTIFY_USER":
      return (
        <div className={box}>
          <Labelled id={id("to")} label="Who">
            <select
              id={id("to")}
              className={cell}
              value={value("to", "LEAD_OWNER")}
              onChange={(event) => onChange({ to: event.target.value })}
            >
              <option value="LEAD_OWNER">The lead&apos;s owner</option>
              <option value="PROJECT_MANAGER">The project manager</option>
              <option value="ROLE">Everyone in a role</option>
              <option value="SPECIFIC">A specific person</option>
            </select>
          </Labelled>
          {value("to") === "ROLE" ? (
            <Labelled id={id("roleName")} label="Role">
              <select
                id={id("roleName")}
                className={cell}
                value={value("roleName")}
                onChange={(event) => onChange({ roleName: event.target.value })}
              >
                <option value="">Choose a role</option>
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {role.toLowerCase().replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Labelled>
          ) : null}
          {value("to") === "SPECIFIC" ? (
            <Labelled id={id("userId")} label="Person">
              <select
                id={id("userId")}
                className={cell}
                value={value("userId")}
                onChange={(event) => onChange({ userId: event.target.value })}
              >
                <option value="">Choose someone</option>
                {staff.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </Labelled>
          ) : null}
          <Labelled id={id("title")} label="Title" wide>
            <input
              id={id("title")}
              className={cell}
              value={value("title")}
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </Labelled>
        </div>
      );

    case "CREATE_PROJECT":
      return (
        <div className={box}>
          <Labelled id={id("nameTemplate")} label="Project name" wide>
            <input
              id={id("nameTemplate")}
              className={cell}
              value={value("nameTemplate")}
              onChange={(event) => onChange({ nameTemplate: event.target.value })}
              placeholder="{{client.name}} onboarding"
            />
          </Labelled>
          <Labelled id={id("managerId")} label="Manager">
            <select
              id={id("managerId")}
              className={cell}
              value={value("managerId")}
              onChange={(event) => onChange({ managerId: event.target.value })}
            >
              <option value="">The first available PM</option>
              {staff.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </Labelled>
          <Labelled id={id("dueInDays")} label="Due in (days)">
            <input
              id={id("dueInDays")}
              className={cell}
              inputMode="numeric"
              value={value("dueInDays")}
              onChange={(event) => onChange({ dueInDays: event.target.value || null })}
              placeholder="blank for none"
            />
          </Labelled>
        </div>
      );

    case "CREATE_PROJECT_TASKS":
      return (
        <div className="mt-3">
          <Labelled id={id("titles")} label="One task per line" wide>
            <textarea
              id={id("titles")}
              className={`${cell} h-auto py-1.5`}
              rows={4}
              value={(Array.isArray(action["titles"]) ? (action["titles"] as string[]) : []).join("\n")}
              onChange={(event) =>
                onChange({
                  titles: event.target.value
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
                })
              }
            />
          </Labelled>
        </div>
      );

    case "SET_LEAD_STATUS":
      return (
        <div className={box}>
          <Labelled id={id("status")} label="Move to">
            <select
              id={id("status")}
              className={cell}
              value={value("status", "CONTACTED")}
              onChange={(event) => onChange({ status: event.target.value })}
            >
              {LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.toLowerCase()}
                </option>
              ))}
            </select>
          </Labelled>
          <p className="self-end pb-1 text-2xs text-ink-subtle sm:col-span-2">
            Winning a lead is not here: that creates a client, and goes through accepting a
            proposal.
          </p>
        </div>
      );

    case "ADD_TAG":
      return (
        <div className={box}>
          <Labelled id={id("tagName")} label="Tag">
            <input
              id={id("tagName")}
              className={cell}
              value={value("tagName")}
              onChange={(event) => onChange({ tagName: event.target.value })}
            />
          </Labelled>
        </div>
      );

    case "CREATE_CLIENT":
      return (
        <p className="mt-2 text-2xs text-ink-subtle">
          Accepting a proposal already creates the client, so on that trigger this reports it rather
          than making a second one.
        </p>
      );

    default:
      return null;
  }
}

function Labelled({
  id,
  label,
  wide,
  children,
}: {
  id: string;
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : undefined}>
      <label htmlFor={id} className="block text-2xs font-medium uppercase tracking-widest text-ink-subtle">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
