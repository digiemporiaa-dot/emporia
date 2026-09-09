"use client";

import * as React from "react";
import { useActionState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, CardBody, Field, Input, Select, Textarea } from "@/components/ui";
import { MediaPicker, type PickedMedia } from "@/components/admin/media-picker";
import { FormStatus, SubmitButton, fieldErrors, useHydrated } from "@/components/admin/form-status";
import { ICON_LABELS, ICON_NAMES } from "@/lib/content/icons";
import type { ServiceBody } from "@/lib/content/entity-body";
import { saveServiceAction, type ServiceActionState } from "../actions";

/**
 * Service editor.
 *
 * The long-form `body` is three fields rather than a rich-text area, because
 * that is exactly what the public service template renders: an intro, an
 * approach paragraph and a list of deliverables. Giving the editor the shape
 * the page actually uses beats giving them a blank canvas the renderer will
 * then ignore.
 */

export type ServiceValues = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string;
  icon: string | null;
  status: string;
  order: number;
  hero: PickedMedia | null;
  body: ServiceBody;
};

export function ServiceForm({ service }: { service?: ServiceValues }) {
  const [state, formAction] = useActionState<ServiceActionState, FormData>(saveServiceAction, null);
  const errors = fieldErrors(state);
  const err = (name: string) => errors[name]?.[0];
  // This form posts its long-form content as JSON only React writes, so saving
  // waits for hydration — see useHydrated.
  const ready = useHydrated();

  const [intro, setIntro] = React.useState(service?.body.intro ?? "");
  const [approach, setApproach] = React.useState(service?.body.approach ?? "");
  const [deliverables, setDeliverables] = React.useState<string[]>(
    service?.body.deliverables ?? [],
  );

  const body: ServiceBody = {
    ...(intro.trim() ? { intro: intro.trim() } : {}),
    ...(approach.trim() ? { approach: approach.trim() } : {}),
    ...(deliverables.some((d) => d.trim())
      ? { deliverables: deliverables.map((d) => d.trim()).filter(Boolean) }
      : {}),
  };

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {service ? <input type="hidden" name="id" value={service.id} /> : null}
      <input type="hidden" name="body" value={JSON.stringify(body)} />

      <FormStatus state={state} savedMessage="Service saved." />

      <Card>
        <CardBody className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="name" label="Name" required error={err("name")}>
              {(aria) => <Input {...aria} name="name" defaultValue={service?.name} required />}
            </Field>
            <Field id="slug" label="Slug" required hint="/services/<slug>" error={err("slug")}>
              {(aria) => <Input {...aria} name="slug" defaultValue={service?.slug} required />}
            </Field>
          </div>

          <Field
            id="shortDescription"
            label="Short description"
            required
            hint="One line. Used on the services index, in cards and in the footer."
            error={err("shortDescription")}
          >
            {(aria) => (
              <Textarea
                {...aria}
                name="shortDescription"
                defaultValue={service?.shortDescription}
                rows={2}
                required
              />
            )}
          </Field>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field id="icon" label="Icon" error={err("icon")}>
              {(aria) => (
                <Select {...aria} name="icon" defaultValue={service?.icon ?? ""}>
                  <option value="">None</option>
                  {ICON_NAMES.map((icon) => (
                    <option key={icon} value={icon}>
                      {ICON_LABELS[icon]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="status" label="Status" error={err("status")}>
              {(aria) => (
                <Select {...aria} name="status" defaultValue={service?.status ?? "DRAFT"}>
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
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
                  defaultValue={service?.order ?? 0}
                />
              )}
            </Field>
          </div>

          <MediaPicker name="heroMediaId" label="Hero image" value={service?.hero ?? null} />
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-5">
          <h2 className="font-display text-lg text-navy-800">Page content</h2>

          <Field id="intro" label="Introduction" hint="The opening paragraph on the service page.">
            {(aria) => (
              <Textarea
                {...aria}
                value={intro}
                onChange={(event) => setIntro(event.target.value)}
                rows={4}
              />
            )}
          </Field>

          <Field id="approach" label="Approach" hint="How the work is actually run.">
            {(aria) => (
              <Textarea
                {...aria}
                value={approach}
                onChange={(event) => setApproach(event.target.value)}
                rows={4}
              />
            )}
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium tracking-wide text-ink-muted">
              Deliverables
            </legend>
            {deliverables.length === 0 ? (
              <p className="text-xs text-ink-subtle">
                None yet. The deliverables list is left out of the page entirely.
              </p>
            ) : null}
            <ul className="space-y-2">
              {deliverables.map((item, index) => (
                <li key={index} className="flex items-center gap-2">
                  <Input
                    value={item}
                    aria-label={`Deliverable ${index + 1}`}
                    onChange={(event) =>
                      setDeliverables(
                        deliverables.map((d, i) => (i === index ? event.target.value : d)),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeliverables(deliverables.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span className="sr-only">Remove deliverable {index + 1}</span>
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDeliverables([...deliverables, ""])}
              disabled={deliverables.length >= 20}
            >
              <Plus size={14} aria-hidden="true" />
              Add deliverable
            </Button>
          </fieldset>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <SubmitButton ready={ready} label={service ? "Save service" : "Create service"} />
      </div>
    </form>
  );
}
