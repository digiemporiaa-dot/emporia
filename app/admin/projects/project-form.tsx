"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL } from "@/lib/projects/lifecycle";
import { saveProjectAction, type DeliveryActionState } from "./actions";

type Option = { id: string; name: string };

type Project = {
  id: string;
  name: string;
  clientId: string;
  serviceId: string | null;
  managerId: string;
  contractId: string | null;
  status: string;
  budget: string;
  currency: string;
  startsAt: Date;
  dueAt: Date | null;
};

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"] as const;

const isoDate = (value: Date | null | undefined) =>
  value ? value.toISOString().slice(0, 10) : "";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Project form.
 *
 * Health is deliberately absent: it is derived from the project's own tasks and
 * milestones, never typed in (lib/projects/health.ts).
 */
export function ProjectForm({
  project,
  clients,
  services,
  staff,
  contracts,
}: {
  project?: Project;
  clients: readonly Option[];
  services: readonly Option[];
  staff: readonly Option[];
  contracts: readonly { id: string; label: string }[];
}) {
  const [state, formAction] = useActionState<DeliveryActionState, FormData>(
    saveProjectAction,
    null,
  );

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  return (
    <form action={formAction} className="max-w-2xl space-y-5" noValidate>
      {project ? <input type="hidden" name="id" value={project.id} /> : null}
      {project ? <input type="hidden" name="clientId" value={project.clientId} /> : null}
      {project ? <input type="hidden" name="status" value={project.status} /> : null}

      {state && !state.ok ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red"
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
          Saved.
        </div>
      ) : null}

      <Field id="name" label="Project name" required error={err("name")}>
        {(aria) => <Input {...aria} name="name" defaultValue={project?.name} required />}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        {project ? null : (
          <Field id="clientId" label="Client" required error={err("clientId")}>
            {(aria) => (
              <Select {...aria} name="clientId" defaultValue="" required>
                <option value="">Choose a client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field id="managerId" label="Project manager" required error={err("managerId")}>
          {(aria) => (
            <Select {...aria} name="managerId" defaultValue={project?.managerId ?? ""} required>
              <option value="">Choose a manager</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="serviceId" label="Service" error={err("serviceId")}>
          {(aria) => (
            <Select {...aria} name="serviceId" defaultValue={project?.serviceId ?? ""}>
              <option value="">None</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id="contractId"
          label="Contract"
          hint="Links the work to what was signed"
          error={err("contractId")}
        >
          {(aria) => (
            <Select {...aria} name="contractId" defaultValue={project?.contractId ?? ""}>
              <option value="">None</option>
              {contracts.map((contract) => (
                <option key={contract.id} value={contract.id}>
                  {contract.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {project ? null : (
          <Field id="status" label="Status" error={err("status")}>
            {(aria) => (
              <Select {...aria} name="status" defaultValue="PLANNING">
                {PROJECT_STATUSES.filter((s) => s === "PLANNING" || s === "ACTIVE").map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABEL[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field id="budget" label="Budget" hint="Digits only, e.g. 450000.00" error={err("budget")}>
          {(aria) => (
            <Input
              {...aria}
              name="budget"
              inputMode="decimal"
              defaultValue={project?.budget ?? "0"}
            />
          )}
        </Field>

        <Field id="currency" label="Currency" error={err("currency")}>
          {(aria) => (
            <Select {...aria} name="currency" defaultValue={project?.currency ?? "INR"}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="startsAt" label="Starts" required error={err("startsAt")}>
          {(aria) => (
            <Input
              {...aria}
              name="startsAt"
              type="date"
              defaultValue={isoDate(project?.startsAt)}
              required
            />
          )}
        </Field>

        <Field id="dueAt" label="Due" error={err("dueAt")}>
          {(aria) => (
            <Input {...aria} name="dueAt" type="date" defaultValue={isoDate(project?.dueAt)} />
          )}
        </Field>
      </div>

      <Submit label={project ? "Save project" : "Create project"} />
    </form>
  );
}
