"use client";

import { useActionState } from "react";
import { Card, CardBody, Field, Input, Select, Textarea } from "@/components/ui";
import { MediaPicker, type PickedMedia } from "@/components/admin/media-picker";
import { FormStatus, SubmitButton, fieldErrors } from "@/components/admin/form-status";
import { saveTestimonialAction, type SavedState } from "../content-actions";

/**
 * Testimonial editor.
 *
 * A quote attributed to a named person. There is no AI draft and no generator
 * anywhere near this form on purpose — a fabricated testimonial is the single
 * most damaging thing this system could produce (CLAUDE.md 2 rule 5).
 */

export type TestimonialValues = {
  id: string;
  authorName: string;
  authorRole: string | null;
  company: string | null;
  quote: string;
  rating: number | null;
  serviceId: string | null;
  cityId: string | null;
  status: string;
  order: number;
  avatar: PickedMedia | null;
};

export function TestimonialForm({
  testimonial,
  services,
  cities,
}: {
  testimonial?: TestimonialValues;
  services: readonly { id: string; name: string }[];
  cities: readonly { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState<SavedState, FormData>(saveTestimonialAction, null);
  const errors = fieldErrors(state);
  const err = (name: string) => errors[name]?.[0];

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {testimonial ? <input type="hidden" name="id" value={testimonial.id} /> : null}
      <FormStatus state={state} savedMessage="Testimonial saved." />

      <Card>
        <CardBody className="space-y-5">
          <Field
            id="quote"
            label="Quote"
            required
            hint="In their words. Do not paraphrase into marketing copy."
            error={err("quote")}
          >
            {(aria) => (
              <Textarea
                {...aria}
                name="quote"
                defaultValue={testimonial?.quote}
                rows={4}
                required
              />
            )}
          </Field>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field id="authorName" label="Name" required error={err("authorName")}>
              {(aria) => (
                <Input
                  {...aria}
                  name="authorName"
                  defaultValue={testimonial?.authorName}
                  required
                />
              )}
            </Field>
            <Field id="authorRole" label="Role" error={err("authorRole")}>
              {(aria) => (
                <Input {...aria} name="authorRole" defaultValue={testimonial?.authorRole ?? ""} />
              )}
            </Field>
            <Field id="company" label="Company" error={err("company")}>
              {(aria) => (
                <Input {...aria} name="company" defaultValue={testimonial?.company ?? ""} />
              )}
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-4">
            <Field
              id="rating"
              label="Rating"
              hint="Blank if they did not give one."
              error={err("rating")}
            >
              {(aria) => (
                <Select
                  {...aria}
                  name="rating"
                  defaultValue={testimonial?.rating?.toString() ?? ""}
                >
                  <option value="">None</option>
                  {[5, 4, 3, 2, 1].map((value) => (
                    <option key={value} value={value}>
                      {value} star{value === 1 ? "" : "s"}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="serviceId" label="Service" error={err("serviceId")}>
              {(aria) => (
                <Select {...aria} name="serviceId" defaultValue={testimonial?.serviceId ?? ""}>
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
                <Select {...aria} name="cityId" defaultValue={testimonial?.cityId ?? ""}>
                  <option value="">None</option>
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="order" label="Order" hint="Lower sorts first." error={err("order")}>
              {(aria) => (
                <Input
                  {...aria}
                  name="order"
                  type="number"
                  min={0}
                  defaultValue={testimonial?.order ?? 0}
                />
              )}
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="status" label="Status" error={err("status")}>
              {(aria) => (
                <Select {...aria} name="status" defaultValue={testimonial?.status ?? "DRAFT"}>
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </Select>
              )}
            </Field>
          </div>

          <MediaPicker name="avatarId" label="Photo" value={testimonial?.avatar ?? null} />
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <SubmitButton label={testimonial ? "Save testimonial" : "Add testimonial"} />
      </div>
    </form>
  );
}
