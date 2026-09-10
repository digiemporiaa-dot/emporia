"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  Field,
  Input,
  Select,
  Table,
  TableEmpty,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
} from "@/components/ui";
import { useHydrated } from "@/lib/utils/hydrated";
import { BLOCK_GROUPS, BLOCK_LIBRARY } from "@/lib/content/blocks";
import {
  deleteTemplateAction,
  saveTemplateAction,
  type TemplateActionState,
} from "./actions";

/**
 * Page templates.
 *
 * A template says which bands a page of this kind starts with, which bands it
 * may carry at all, and what its SEO defaults to.
 *
 * Both lists are checkbox groups posted as repeated fields rather than JSON
 * assembled in React. A form whose content only exists once JavaScript has run
 * submits empty before hydration, which is the defect this project has hit
 * three times.
 */

export type TemplateRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  sectionTypes: string[];
  allowedBlocks: string[];
  defaultSchemaType: string;
  defaultRobotsIndex: boolean;
  isActive: boolean;
  order: number;
  pages: number;
};

const SCHEMA_TYPES = [
  { value: "NONE", label: "None" },
  { value: "FAQ_PAGE", label: "FAQ page" },
  { value: "SERVICE", label: "Service" },
  { value: "ARTICLE", label: "Article" },
  { value: "LOCAL_BUSINESS", label: "Local business" },
  { value: "ORGANIZATION", label: "Organization" },
  { value: "WEBSITE", label: "Website" },
] as const;

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
      <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const ready = useHydrated();
  return (
    <Button type="submit" size="sm" disabled={pending || !ready}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/** A checkbox per block, grouped the way the builder groups them. */
function BlockChoices({
  name,
  selected,
  legend,
  hint,
}: {
  name: string;
  selected: readonly string[];
  legend: string;
  hint: string;
}) {
  return (
    <fieldset className="rounded-lg border border-line p-4">
      <legend className="px-1 text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
        {legend}
      </legend>
      <p className="mb-3 text-xs text-ink-subtle">{hint}</p>
      <div className="space-y-4">
        {BLOCK_GROUPS.map((group) => {
          const blocks = BLOCK_LIBRARY.filter((block) => block.group === group);
          if (blocks.length === 0) return null;
          return (
            <div key={group}>
              <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                {group}
              </p>
              <div className="grid gap-1 sm:grid-cols-3">
                {blocks.map((block) => (
                  <label key={block.type} className="flex items-center gap-1.5 text-xs text-ink">
                    <input
                      type="checkbox"
                      name={name}
                      value={block.type}
                      defaultChecked={selected.includes(block.type)}
                      className="h-3.5 w-3.5 rounded-sm border-line-strong text-brand-red"
                    />
                    {block.label}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function TemplateForm({ row, onDone }: { row: TemplateRow | null; onDone: () => void }) {
  const [state, formAction] = useActionState<TemplateActionState, FormData>(
    saveTemplateAction,
    null,
  );
  const fieldErrors =
    state && !state.ok && state.details && typeof state.details === "object"
      ? (state.details as Record<string, string[] | undefined>)
      : null;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  React.useEffect(() => {
    if (state?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire on a successful save
  }, [state]);

  return (
    <Card>
      <CardBody>
        <h2 className="font-display text-lg text-navy-800">
          {row ? "Edit template" : "New template"}
        </h2>

        <form action={formAction} className="mt-4 space-y-4" noValidate>
          {row ? <input type="hidden" name="id" value={row.id} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Name" required error={err("name")}>
              {(aria) => <Input {...aria} name="name" defaultValue={row?.name ?? ""} required />}
            </Field>
            <Field
              id="key"
              label="Handle"
              required
              hint="Lower-case, dashes. Lets a seed name it without knowing its id."
              error={err("key")}
            >
              {(aria) => (
                <Input {...aria} name="key" defaultValue={row?.key ?? ""} placeholder="service-landing" required />
              )}
            </Field>
          </div>

          <Field
            id="description"
            label="Description"
            hint="Shown beside the template when someone picks it."
            error={err("description")}
          >
            {(aria) => (
              <Textarea {...aria} name="description" rows={2} defaultValue={row?.description ?? ""} />
            )}
          </Field>

          <BlockChoices
            name="section"
            legend="Starts with"
            hint="The bands a new page opens with, in the order below. Each starts from its own defaults — the words are written on the page, not here."
            selected={row?.sectionTypes ?? []}
          />

          <BlockChoices
            name="allowedBlock"
            legend="May contain"
            hint="Tick nothing to allow every band, which is what a general-purpose template wants. Ticking some restricts the page to those — enforced when a band is added, not just hidden from the picker."
            selected={row?.allowedBlocks ?? []}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="defaultSchemaType" label="Default structured data">
              {(aria) => (
                <Select
                  {...aria}
                  name="defaultSchemaType"
                  defaultValue={row?.defaultSchemaType ?? "NONE"}
                >
                  {SCHEMA_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="order" label="Order" hint="Lower sorts first in the New page list.">
              {(aria) => (
                <Input {...aria} name="order" type="number" min={0} defaultValue={row?.order ?? 0} />
              )}
            </Field>
          </div>

          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-2 text-sm text-navy-800">
              <input
                type="checkbox"
                name="defaultRobotsIndex"
                defaultChecked={row ? row.defaultRobotsIndex : true}
                className="h-4 w-4 rounded-sm border-line-strong text-brand-red"
              />
              Indexable by default
            </label>
            <label className="flex items-center gap-2 text-sm text-navy-800">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={row ? row.isActive : true}
                className="h-4 w-4 rounded-sm border-line-strong text-brand-red"
              />
              Offered for new pages
            </label>
          </div>

          {state && !state.ok ? <Problem message={state.message} /> : null}

          <div className="flex items-center gap-2">
            <Submit label={row ? "Save template" : "Create template"} />
            <Button type="button" size="sm" variant="secondary" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function TemplateManager({
  rows,
  canEdit,
}: {
  rows: TemplateRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<TemplateRow | null | "new">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      {canEdit ? (
        <div className="flex">
          <Button size="sm" className="ml-auto" onClick={() => setEditing("new")}>
            <Plus size={14} aria-hidden="true" />
            New template
          </Button>
        </div>
      ) : null}

      {editing ? (
        <TemplateForm
          row={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      <Problem message={error} />

      <TableWrap label="Templates">
        <Table>
          <THead>
            <TR>
              <TH>Template</TH>
              <TH className="text-right">Starts with</TH>
              <TH>Allows</TH>
              <TH className="text-right">Pages</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TableEmpty
                colSpan={5}
                title="No templates"
                description="A template gives a new page its opening bands and decides which bands it may carry. Without one, every page starts blank and may hold anything."
              />
            ) : (
              rows.map((row) => (
                <TR key={row.id}>
                  <TD>
                    <span className="font-medium text-navy-800">{row.name}</span>
                    <span className="block font-mono text-2xs text-ink-subtle">{row.key}</span>
                  </TD>
                  <TD className="text-right tabular-nums">{row.sectionTypes.length}</TD>
                  <TD className="text-xs text-ink-subtle">
                    {row.allowedBlocks.length === 0
                      ? "Every band"
                      : `${row.allowedBlocks.length} of ${BLOCK_LIBRARY.length}`}
                  </TD>
                  <TD className="text-right tabular-nums">{row.pages}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1.5">
                      {row.isActive ? null : <Badge tone="warning">Off</Badge>}
                      {canEdit ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditing(row)}
                            className="rounded-sm px-2 py-1 text-xs text-navy-800 hover:text-brand-red"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              setError(null);
                              start(async () => {
                                const result = await deleteTemplateAction(row.id);
                                if (!result.ok) setError(result.message);
                                else router.refresh();
                              });
                            }}
                            className="rounded-sm p-1 text-ink-subtle hover:text-brand-red disabled:opacity-50"
                          >
                            <Trash2 size={13} aria-hidden="true" />
                            <span className="sr-only">Delete the {row.name} template</span>
                          </button>
                        </>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
    </div>
  );
}
