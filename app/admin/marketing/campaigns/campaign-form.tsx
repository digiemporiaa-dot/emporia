"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { saveCampaignAction, type CampaignActionState } from "./actions";

/** Creating and editing a campaign. Budget is a string end to end. */

export type CampaignValues = {
  id: string;
  name: string;
  clientId: string | null;
  platform: string;
  objective: string | null;
  budget: string;
  currency: string;
  ownerId: string;
  status: string;
  startsAt: string;
  endsAt: string | null;
};

const PLATFORMS = [
  ["GOOGLE_ADS", "Google Ads"],
  ["META_ADS", "Meta Ads"],
  ["LINKEDIN_ADS", "LinkedIn Ads"],
  ["SEO", "SEO"],
  ["EMAIL", "Email"],
  ["SOCIAL_ORGANIC", "Organic social"],
  ["OTHER", "Other"],
] as const;

const STATUSES = [
  ["DRAFT", "Draft"],
  ["ACTIVE", "Active"],
  ["PAUSED", "Paused"],
  ["COMPLETED", "Completed"],
] as const;

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"] as const;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function CampaignForm({
  campaign,
  clients,
  staff,
}: {
  campaign?: CampaignValues;
  clients: readonly { id: string; name: string }[];
  staff: readonly { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState<CampaignActionState, FormData>(
    saveCampaignAction,
    null,
  );

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {campaign ? <input type="hidden" name="id" value={campaign.id} /> : null}

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
          Saved.{" "}
          {campaign ? null : (
            <Link
              href={`/admin/marketing/campaigns/${state.data.id}`}
              className="font-medium underline underline-offset-2"
            >
              Open it to add performance data
            </Link>
          )}
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="name" label="Name" required error={err("name")}>
          {(aria) => (
            <Input {...aria} name="name" defaultValue={campaign?.name} maxLength={160} required />
          )}
        </Field>

        <Field id="platform" label="Platform" required error={err("platform")}>
          {(aria) => (
            <Select {...aria} name="platform" defaultValue={campaign?.platform ?? "GOOGLE_ADS"}>
              {PLATFORMS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="status" label="Status" error={err("status")}>
          {(aria) => (
            <Select {...aria} name="status" defaultValue={campaign?.status ?? "DRAFT"}>
              {STATUSES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="clientId" label="Client" hint="Leave blank for our own marketing">
          {(aria) => (
            <Select {...aria} name="clientId" defaultValue={campaign?.clientId ?? ""}>
              <option value="">None</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field id="ownerId" label="Owner" required error={err("ownerId")}>
          {(aria) => (
            <Select {...aria} name="ownerId" defaultValue={campaign?.ownerId ?? ""} required>
              <option value="">Choose an owner</option>
              {staff.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2">
          <Field id="budget" label="Budget" error={err("budget")}>
            {(aria) => (
              <Input
                {...aria}
                name="budget"
                inputMode="decimal"
                defaultValue={campaign?.budget ?? "0.00"}
              />
            )}
          </Field>
          <Field id="currency" label="Currency">
            {(aria) => (
              <Select {...aria} name="currency" defaultValue={campaign?.currency ?? "INR"}>
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field id="startsAt" label="Starts" required error={err("startsAt")}>
          {(aria) => (
            <Input
              {...aria}
              name="startsAt"
              type="date"
              defaultValue={campaign?.startsAt ?? new Date().toISOString().slice(0, 10)}
              required
            />
          )}
        </Field>

        <Field id="endsAt" label="Ends" hint="Blank for open-ended" error={err("endsAt")}>
          {(aria) => <Input {...aria} name="endsAt" type="date" defaultValue={campaign?.endsAt ?? ""} />}
        </Field>
      </div>

      <Field id="objective" label="Objective" hint="What this campaign is meant to achieve">
        {(aria) => (
          <Textarea {...aria} name="objective" rows={2} defaultValue={campaign?.objective ?? ""} maxLength={200} />
        )}
      </Field>

      <Submit label={campaign ? "Save campaign" : "Create campaign"} />
    </form>
  );
}
