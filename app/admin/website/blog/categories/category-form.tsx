"use client";

import { useActionState } from "react";
import { Field, Input, Textarea } from "@/components/ui";
import { FormStatus, SubmitButton, fieldErrors } from "@/components/admin/form-status";
import { saveCategoryAction, type SavedState } from "../../content-actions";

export type CategoryValues = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
};

export function CategoryForm({ category }: { category?: CategoryValues }) {
  const [state, formAction] = useActionState<SavedState, FormData>(saveCategoryAction, null);
  const errors = fieldErrors(state);
  const err = (name: string) => errors[name]?.[0];

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {category ? <input type="hidden" name="id" value={category.id} /> : null}
      <FormStatus state={state} savedMessage="Category saved." />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`cat-name-${category?.id ?? "new"}`} label="Name" required error={err("name")}>
          {(aria) => <Input {...aria} name="name" defaultValue={category?.name} required />}
        </Field>
        <Field
          id={`cat-slug-${category?.id ?? "new"}`}
          label="Slug"
          required
          hint="/blog/category/<slug>"
          error={err("slug")}
        >
          {(aria) => <Input {...aria} name="slug" defaultValue={category?.slug} required />}
        </Field>
      </div>

      <Field
        id={`cat-desc-${category?.id ?? "new"}`}
        label="Description"
        error={err("description")}
      >
        {(aria) => (
          <Textarea
            {...aria}
            name="description"
            defaultValue={category?.description ?? ""}
            rows={2}
          />
        )}
      </Field>

      <div className="flex justify-end">
        <SubmitButton label={category ? "Save" : "Add category"} />
      </div>
    </form>
  );
}
