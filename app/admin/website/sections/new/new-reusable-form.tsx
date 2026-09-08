"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { createReusableSectionAction, type ReusableActionState } from "../../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create section"}
    </Button>
  );
}

export function NewReusableForm({
  blocks,
}: {
  blocks: readonly { type: string; label: string }[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<ReusableActionState, FormData>(
    createReusableSectionAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) router.push(`/admin/website/sections/${state.data.id}`);
  }, [state, router]);

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  return (
    <form action={formAction} className="max-w-xl space-y-5" noValidate>
      {state && !state.ok ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
        >
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      ) : null}

      <Field id="name" label="Name" required hint="Shown in the admin, not on the page." error={err("name")}>
        {(aria) => <Input {...aria} name="name" required autoFocus />}
      </Field>

      <Field id="type" label="Block" required error={err("type")}>
        {(aria) => (
          <Select {...aria} name="type" defaultValue="cta">
            {blocks.map((block) => (
              <option key={block.type} value={block.type}>
                {block.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <label className="flex items-start gap-2 text-sm text-navy-800">
        <input
          type="checkbox"
          name="isGlobal"
          className="mt-0.5 size-4 rounded-xs border-line-strong text-brand-red"
        />
        <span>
          Mark as a global section
          <span className="mt-0.5 block text-xs text-ink-subtle">
            A standard band for the whole site, listed first when placing one.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <Submit />
        <Link href="/admin/website/sections">
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
