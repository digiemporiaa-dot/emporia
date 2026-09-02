"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { saveCatalogItemAction, type SalesActionState } from "../actions";

type CatalogItem = {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  unitPrice: string;
  currency: string;
  taxRate: string;
  serviceId: string | null;
  isActive: boolean;
  order: number;
};

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"] as const;

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * Catalog item editor. Prices are strings from the input to the database; a
 * catalog price is the origin of every quoted line, so it must not pass
 * through a JS number on the way in (CLAUDE.md 2 rule 1).
 */
export function CatalogForm({
  item,
  services,
}: {
  item?: CatalogItem;
  services: readonly { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState<SalesActionState, FormData>(
    saveCatalogItemAction,
    null,
  );

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];
  const uid = item ? item.id : "new";

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {item ? <input type="hidden" name="id" value={item.id} /> : null}

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
        <p role="status" className="text-xs text-success">
          Saved.
        </p>
      ) : null}

      <Field id={`${uid}-name`} label="Name" required error={err("name")}>
        {(aria) => <Input {...aria} name="name" defaultValue={item?.name} required />}
      </Field>

      <Field id={`${uid}-description`} label="Description" error={err("description")}>
        {(aria) => (
          <Textarea {...aria} name="description" rows={2} defaultValue={item?.description ?? ""} />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id={`${uid}-unitPrice`} label="Unit price" required error={err("unitPrice")}>
          {(aria) => (
            <Input
              {...aria}
              name="unitPrice"
              inputMode="decimal"
              defaultValue={item?.unitPrice ?? ""}
              required
            />
          )}
        </Field>
        <Field id={`${uid}-currency`} label="Currency" error={err("currency")}>
          {(aria) => (
            <Select {...aria} name="currency" defaultValue={item?.currency ?? "INR"}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={`${uid}-unit`} label="Unit" hint="e.g. month, hour, page" error={err("unit")}>
          {(aria) => <Input {...aria} name="unit" defaultValue={item?.unit ?? "month"} />}
        </Field>
        <Field id={`${uid}-taxRate`} label="Tax rate" hint="Percent" error={err("taxRate")}>
          {(aria) => (
            <Input {...aria} name="taxRate" inputMode="decimal" defaultValue={item?.taxRate ?? "18"} />
          )}
        </Field>
        <Field id={`${uid}-serviceId`} label="Service" error={err("serviceId")}>
          {(aria) => (
            <Select {...aria} name="serviceId" defaultValue={item?.serviceId ?? ""}>
              <option value="">None</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={`${uid}-order`} label="Order" error={err("order")}>
          {(aria) => (
            <Input {...aria} name="order" type="number" min={0} defaultValue={item?.order ?? 0} />
          )}
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={item ? item.isActive : true}
          className="size-4 rounded border-border text-brand-red focus-visible:ring-2 focus-visible:ring-brand-red/40"
        />
        Available for quoting
      </label>

      <Submit label={item ? "Save item" : "Add item"} />
    </form>
  );
}
