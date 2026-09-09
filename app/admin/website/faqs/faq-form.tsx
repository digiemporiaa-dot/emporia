"use client";

import { useActionState } from "react";
import { Card, CardBody, Field, Input, Select, Textarea } from "@/components/ui";
import { FormStatus, SubmitButton, fieldErrors } from "@/components/admin/form-status";
import { saveFaqAction, type SavedState } from "../content-actions";

/**
 * FAQ editor.
 *
 * An FAQ has to be attached to a service, a city or a package, because that is
 * where it renders. The service rejects an unattached one rather than storing a
 * row nothing will ever show.
 */

export type FaqValues = {
  id: string;
  question: string;
  answer: string;
  serviceId: string | null;
  cityId: string | null;
  packageId: string | null;
  order: number;
  isActive: boolean;
};

export function FaqForm({
  faq,
  services,
  cities,
  packages,
}: {
  faq?: FaqValues;
  services: readonly { id: string; name: string }[];
  cities: readonly { id: string; name: string }[];
  packages: readonly { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState<SavedState, FormData>(saveFaqAction, null);
  const errors = fieldErrors(state);
  const err = (name: string) => errors[name]?.[0];

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {faq ? <input type="hidden" name="id" value={faq.id} /> : null}
      <FormStatus state={state} savedMessage="FAQ saved." />

      <Card>
        <CardBody className="space-y-5">
          <Field id="question" label="Question" required error={err("question")}>
            {(aria) => <Input {...aria} name="question" defaultValue={faq?.question} required />}
          </Field>

          <Field id="answer" label="Answer" required error={err("answer")}>
            {(aria) => (
              <Textarea {...aria} name="answer" defaultValue={faq?.answer} rows={5} required />
            )}
          </Field>

          <fieldset className="space-y-4">
            <legend className="text-xs font-medium tracking-wide text-ink-muted">
              Where it appears
            </legend>
            <p className="text-xs text-ink-subtle">
              Choose at least one. An FAQ attached to nothing renders nowhere.
            </p>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field id="serviceId" label="Service" error={err("serviceId")}>
                {(aria) => (
                  <Select {...aria} name="serviceId" defaultValue={faq?.serviceId ?? ""}>
                    <option value="">None</option>
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="cityId" label="City" error={err("cityId")}>
                {(aria) => (
                  <Select {...aria} name="cityId" defaultValue={faq?.cityId ?? ""}>
                    <option value="">None</option>
                    {cities.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="packageId" label="Package" error={err("packageId")}>
                {(aria) => (
                  <Select {...aria} name="packageId" defaultValue={faq?.packageId ?? ""}>
                    <option value="">None</option>
                    {packages.map((pkg) => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </fieldset>

          <div className="flex flex-wrap items-end gap-6">
            <Field id="order" label="Order" hint="Lower sorts first." error={err("order")}>
              {(aria) => (
                <Input
                  {...aria}
                  name="order"
                  type="number"
                  min={0}
                  defaultValue={faq?.order ?? 0}
                />
              )}
            </Field>
            <label className="flex items-center gap-2 pb-2.5 text-sm text-navy-800">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={faq?.isActive ?? true}
                className="h-4 w-4 accent-brand-red"
              />
              Show on the site
            </label>
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <SubmitButton label={faq ? "Save FAQ" : "Add FAQ"} />
      </div>
    </form>
  );
}
