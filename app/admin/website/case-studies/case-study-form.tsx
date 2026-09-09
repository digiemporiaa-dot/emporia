"use client";

import * as React from "react";
import { useActionState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, CardBody, Field, Input, Select, Textarea } from "@/components/ui";
import { MediaPicker, type PickedMedia } from "@/components/admin/media-picker";
import { FormStatus, SubmitButton, fieldErrors, useHydrated } from "@/components/admin/form-status";
import type { CaseBody } from "@/lib/content/entity-body";
import { saveCaseStudyAction, type SavedState } from "../content-actions";

/**
 * Case study editor.
 *
 * Metrics are free text on purpose — "3.4x", "+180%", "₹4.2L" — and nothing in
 * the system computes or aggregates them. They are the numbers the client
 * agreed to publish, typed by someone who has them (CLAUDE.md 2 rule 5).
 */

type Metric = { label: string; value: string; unit: string | null };

export type CaseStudyValues = {
  id: string;
  title: string;
  slug: string;
  clientName: string;
  summary: string;
  serviceId: string | null;
  cityId: string | null;
  status: string;
  cover: PickedMedia | null;
  metrics: Metric[];
  body: CaseBody;
};

export function CaseStudyForm({
  study,
  services,
  cities,
}: {
  study?: CaseStudyValues;
  services: readonly { id: string; name: string }[];
  cities: readonly { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState<SavedState, FormData>(saveCaseStudyAction, null);
  const errors = fieldErrors(state);
  const err = (name: string) => errors[name]?.[0];
  // This form posts its long-form content as JSON only React writes, so saving
  // waits for hydration — see useHydrated.
  const ready = useHydrated();

  const [challenge, setChallenge] = React.useState(study?.body.challenge ?? "");
  const [approach, setApproach] = React.useState(study?.body.approach ?? "");
  const [outcome, setOutcome] = React.useState(study?.body.outcome ?? "");
  const [metrics, setMetrics] = React.useState<Metric[]>(study?.metrics ?? []);

  const body: CaseBody = {
    ...(challenge.trim() ? { challenge: challenge.trim() } : {}),
    ...(approach.trim() ? { approach: approach.trim() } : {}),
    ...(outcome.trim() ? { outcome: outcome.trim() } : {}),
  };

  const patch = (index: number, changes: Partial<Metric>) =>
    setMetrics(metrics.map((m, i) => (i === index ? { ...m, ...changes } : m)));

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {study ? <input type="hidden" name="id" value={study.id} /> : null}
      <input type="hidden" name="body" value={JSON.stringify(body)} />
      <input type="hidden" name="metrics" value={JSON.stringify(metrics)} />

      <FormStatus state={state} savedMessage="Case study saved." />

      <Card>
        <CardBody className="space-y-5">
          <Field id="title" label="Title" required error={err("title")}>
            {(aria) => <Input {...aria} name="title" defaultValue={study?.title} required />}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="slug" label="Slug" required hint="/case-studies/<slug>" error={err("slug")}>
              {(aria) => <Input {...aria} name="slug" defaultValue={study?.slug} required />}
            </Field>
            <Field id="clientName" label="Client" required error={err("clientName")}>
              {(aria) => (
                <Input {...aria} name="clientName" defaultValue={study?.clientName} required />
              )}
            </Field>
          </div>

          <Field
            id="summary"
            label="Summary"
            required
            hint="One paragraph, shown on the index and in case-study cards."
            error={err("summary")}
          >
            {(aria) => (
              <Textarea {...aria} name="summary" defaultValue={study?.summary} rows={3} required />
            )}
          </Field>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field id="serviceId" label="Service" error={err("serviceId")}>
              {(aria) => (
                <Select {...aria} name="serviceId" defaultValue={study?.serviceId ?? ""}>
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
                <Select {...aria} name="cityId" defaultValue={study?.cityId ?? ""}>
                  <option value="">None</option>
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="status" label="Status" error={err("status")}>
              {(aria) => (
                <Select {...aria} name="status" defaultValue={study?.status ?? "DRAFT"}>
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </Select>
              )}
            </Field>
          </div>

          <MediaPicker name="coverId" label="Cover image" value={study?.cover ?? null} />
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-5">
          <h2 className="font-display text-lg text-navy-800">The story</h2>

          <Field id="challenge" label="The challenge">
            {(aria) => (
              <Textarea
                {...aria}
                value={challenge}
                onChange={(event) => setChallenge(event.target.value)}
                rows={4}
              />
            )}
          </Field>
          <Field id="approach" label="What we did">
            {(aria) => (
              <Textarea
                {...aria}
                value={approach}
                onChange={(event) => setApproach(event.target.value)}
                rows={4}
              />
            )}
          </Field>
          <Field id="outcome" label="The outcome">
            {(aria) => (
              <Textarea
                {...aria}
                value={outcome}
                onChange={(event) => setOutcome(event.target.value)}
                rows={4}
              />
            )}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-4">
          <div>
            <h2 className="font-display text-lg text-navy-800">Metrics</h2>
            <p className="mt-1 text-xs text-ink-subtle">
              Exactly as agreed with the client. Nothing here is calculated or checked — type the
              figure you can stand behind.
            </p>
          </div>

          <ul className="space-y-2">
            {metrics.map((metric, index) => (
              <li
                key={index}
                className="flex flex-wrap items-start gap-2 rounded-md border border-line bg-surface-muted p-3"
              >
                <div className="min-w-44 flex-[2]">
                  <Field id={`metric-${index}-label`} label="Label">
                    {(aria) => (
                      <Input
                        {...aria}
                        value={metric.label}
                        placeholder="Organic sessions"
                        onChange={(event) => patch(index, { label: event.target.value })}
                      />
                    )}
                  </Field>
                </div>
                <div className="min-w-28 flex-1">
                  <Field id={`metric-${index}-value`} label="Value">
                    {(aria) => (
                      <Input
                        {...aria}
                        value={metric.value}
                        placeholder="+180%"
                        onChange={(event) => patch(index, { value: event.target.value })}
                      />
                    )}
                  </Field>
                </div>
                <div className="min-w-24 flex-1">
                  <Field id={`metric-${index}-unit`} label="Unit">
                    {(aria) => (
                      <Input
                        {...aria}
                        value={metric.unit ?? ""}
                        placeholder="in 6 months"
                        onChange={(event) =>
                          patch(index, {
                            unit: event.target.value === "" ? null : event.target.value,
                          })
                        }
                      />
                    )}
                  </Field>
                </div>
                <div className="pt-6">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setMetrics(metrics.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span className="sr-only">Remove metric {index + 1}</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setMetrics([...metrics, { label: "", value: "", unit: null }])}
            disabled={metrics.length >= 8}
          >
            <Plus size={14} aria-hidden="true" />
            Add metric
          </Button>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <SubmitButton ready={ready} label={study ? "Save case study" : "Create case study"} />
      </div>
    </form>
  );
}
