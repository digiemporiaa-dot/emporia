"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { MediaPicker, type PickedMedia } from "@/components/admin/media-picker";
import { ICON_LABELS, ICON_NAMES } from "@/lib/content/icons";
import type { BlockType } from "@/lib/content/blocks";
import { EMPTY_TAXONOMY, type TaxonomyOption, type TaxonomyOptions } from "@/lib/content/taxonomy";

/**
 * Editors for each block type.
 *
 * Content is held in React state as a plain object and handed to the server
 * action whole; the service validates it against that block's zod schema and
 * stores the parsed result. So these forms shape the input, they do not
 * validate it — the browser's copy of the rules is never the one that counts
 * (CLAUDE.md 2 rule 4).
 */

export type Content = Record<string, unknown>;

type FieldProps = {
  content: Content;
  set: (patch: Content) => void;
  errors: Record<string, string[]> | null;
  media: PickedMedia | null;
  /** Images already chosen by a card, keyed by media id. */
  cardMedia?: Readonly<Record<string, PickedMedia>>;
  /** Services, cities, categories and tags a dynamic block can filter by. */
  taxonomy?: TaxonomyOptions;
};

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(str) : []);
const grid = (value: unknown): string[][] =>
  Array.isArray(value) ? value.map((row) => list(row)) : [];
const items = (value: unknown): Content[] =>
  Array.isArray(value)
    ? value.map((item) => (item && typeof item === "object" ? { ...(item as Content) } : {}))
    : [];

function useErr(errors: Record<string, string[]> | null) {
  return (name: string) => errors?.[name]?.[0];
}

function ImageField({ set, media, label = "Image" }: FieldProps & { label?: string }) {
  return (
    <MediaPicker
      name="mediaId"
      label={label}
      accept="IMAGE"
      value={media}
      onChange={(picked) => set({ mediaId: picked?.id ?? "" })}
      hint="Alt text below overrides the media library's own for this placement."
    />
  );
}

/** Repeating single-line values: feature bullets, table headers. */
function StringList({
  label,
  values,
  onChange,
  addLabel,
  max = 8,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  addLabel: string;
  max?: number;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </legend>
      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label={`${label} ${index + 1}`}
              value={value}
              onChange={(e) => {
                const next = [...values];
                next[index] = e.target.value;
                onChange(next);
              }}
            />
            <button
              type="button"
              aria-label={`Remove ${label} ${index + 1}`}
              onClick={() => onChange(values.filter((_, i) => i !== index))}
              className="rounded-sm p-1.5 text-ink-subtle hover:text-brand-red"
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      {values.length < max ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() => onChange([...values, ""])}
        >
          <Plus size={13} aria-hidden="true" />
          {addLabel}
        </Button>
      ) : null}
    </fieldset>
  );
}

function TableEditor({ content, set, errors }: FieldProps) {
  const headers = list(content["headers"]);
  const rows = grid(content["rows"]);
  const err = useErr(errors);

  const setCell = (r: number, c: number, value: string) => {
    const next = rows.map((row) => [...row]);
    const target = next[r];
    if (target) target[c] = value;
    set({ rows: next });
  };

  return (
    <div className="space-y-4">
      <StringList
        label="Columns"
        values={headers}
        addLabel="Add column"
        onChange={(next) => {
          // Every row keeps exactly as many cells as there are columns, so the
          // table can never render ragged.
          set({
            headers: next,
            rows: rows.map((row) => Array.from({ length: next.length }, (_, i) => row[i] ?? "")),
          });
        }}
      />
      {err("headers") ? <p className="text-xs text-brand-red-text">{err("headers")}</p> : null}

      <div>
        <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Rows</p>
        <div className="space-y-2">
          {rows.map((row, r) => (
            <div key={r} className="flex items-start gap-2">
              <div
                className="grid flex-1 gap-2"
                style={{
                  gridTemplateColumns: `repeat(${Math.max(1, headers.length)}, minmax(0, 1fr))`,
                }}
              >
                {Array.from({ length: Math.max(1, headers.length) }, (_, c) => (
                  <Input
                    key={c}
                    aria-label={`Row ${r + 1}, ${headers[c] || `column ${c + 1}`}`}
                    value={row[c] ?? ""}
                    onChange={(e) => setCell(r, c, e.target.value)}
                  />
                ))}
              </div>
              <button
                type="button"
                aria-label={`Remove row ${r + 1}`}
                onClick={() => set({ rows: rows.filter((_, i) => i !== r) })}
                className="mt-1.5 rounded-sm p-1.5 text-ink-subtle hover:text-brand-red"
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
        {rows.length < 60 ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() =>
              set({ rows: [...rows, Array.from({ length: headers.length }, () => "")] })
            }
          >
            <Plus size={13} aria-hidden="true" />
            Add row
          </Button>
        ) : null}
        {err("rows") ? <p className="mt-1 text-xs text-brand-red-text">{err("rows")}</p> : null}
      </div>
    </div>
  );
}

const RICH_TEXT_HINT =
  "Blank line for a new paragraph. **bold**, *italic*, and [text](/path) for links to pages on this site.";

export function BlockFields({ type, ...props }: FieldProps & { type: BlockType }) {
  const { content, set, errors, media, cardMedia, taxonomy } = props;
  const err = useErr(errors);

  switch (type) {
    case "serviceGrid":
    case "packageGrid":
    case "blogGrid":
    case "caseStudyGrid":
    case "testimonials":
      return (
        <CollectionFields
          type={type}
          content={content}
          set={set}
          errors={errors}
          taxonomy={taxonomy}
        />
      );

    case "clientStrip":
      return (
        <div className="space-y-4">
          <p className="text-xs text-ink-subtle">
            Reads the client names off your published case studies. Nothing to write here — a name
            changed on a case study is changed on the page.
          </p>
          <Field id="label" label="Label" error={err("label")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["label"])}
                placeholder="Selected clients"
                onChange={(e) => set({ label: e.target.value })}
              />
            )}
          </Field>
          <Field id="limit" label="How many" error={err("limit")}>
            {(aria) => (
              <Input
                {...aria}
                type="number"
                min={1}
                max={24}
                value={String(content["limit"] ?? 6)}
                onChange={(e) => set({ limit: Number(e.target.value) })}
              />
            )}
          </Field>
        </div>
      );

    case "stats":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>

          <Choice
            id="stats-source"
            label="Where the numbers come from"
            hint="Case-study metrics are real results already recorded against published work."
            value={str(content["source"]) || "entered"}
            options={[
              ["metrics", "Published case-study metrics"],
              ["entered", "Typed here"],
            ]}
            onChange={(source) => set({ source })}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="stats-limit" label="How many" error={err("limit")}>
              {(aria) => (
                <Input
                  {...aria}
                  type="number"
                  min={1}
                  max={12}
                  value={String(content["limit"] ?? 3)}
                  onChange={(e) => set({ limit: Number(e.target.value) })}
                />
              )}
            </Field>
            <Choice
              id="stats-tone"
              label="Tone"
              value={str(content["tone"]) || "dark"}
              options={[
                ["dark", "Dark band"],
                ["light", "Light band"],
              ]}
              onChange={(tone) => set({ tone })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-navy-800">
            <input
              type="checkbox"
              checked={content["animate"] !== false}
              onChange={(e) => set({ animate: e.target.checked })}
              className="size-4 accent-[var(--color-brand-red)]"
            />
            Count up when the section scrolls into view
          </label>

          {str(content["source"]) === "metrics" ? (
            <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-ink-subtle">
              Reading published case-study metrics. Add or change a metric on the case study itself
              and it changes here.
            </p>
          ) : (
            <>
              <ItemList
                label="Stats"
                values={items(content["items"])}
                addLabel="Add stat"
                blank={{ value: "", label: "" }}
                max={12}
                onChange={(next) => set({ items: next })}
              >
                {(item, patch) => (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <LabelledInput
                        label="Prefix"
                        value={str(item["prefix"])}
                        onChange={(v) => patch({ prefix: v })}
                        placeholder="+"
                      />
                      <LabelledInput
                        label="Number"
                        value={str(item["value"])}
                        onChange={(v) => patch({ value: v })}
                        placeholder="500"
                      />
                      <LabelledInput
                        label="Suffix"
                        value={str(item["suffix"])}
                        onChange={(v) => patch({ suffix: v })}
                        placeholder="%"
                      />
                    </div>
                    <LabelledInput
                      label="Label"
                      value={str(item["label"])}
                      onChange={(v) => patch({ label: v })}
                    />
                    <LabelledInput
                      label="Note"
                      value={str(item["text"])}
                      onChange={(v) => patch({ text: v })}
                    />
                  </>
                )}
              </ItemList>
              {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}
            </>
          )}
        </div>
      );

    case "featureCards":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field id="body" label="Intro" error={err("body")}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={3}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              id="fc-style"
              label="Card style"
              value={str(content["cardStyle"]) || "border"}
              options={CARD_STYLES}
              onChange={(cardStyle) => set({ cardStyle })}
            />
            <Choice
              id="fc-placement"
              label="Icon placement"
              value={str(content["iconPlacement"]) || "top"}
              options={[
                ["top", "Above the copy"],
                ["left", "Beside the copy"],
              ]}
              onChange={(iconPlacement) => set({ iconPlacement })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-navy-800">
            <input
              type="checkbox"
              checked={content["numbered"] === true}
              onChange={(e) => set({ numbered: e.target.checked })}
              className="size-4 accent-[var(--color-brand-red)]"
            />
            Number the features instead of showing an icon
          </label>

          <ItemList
            label="Features"
            values={items(content["items"])}
            addLabel="Add feature"
            blank={{ icon: "sparkles", title: "", text: "", enabled: true }}
            max={24}
            onChange={(next) => set({ items: next })}
          >
            {(item, patch, index) => (
              <>
                <IconSelect
                  id={`fc-icon-${index}`}
                  value={str(item["icon"])}
                  onChange={(v) => patch({ icon: v })}
                />
                <MediaPicker
                  name={`fc-media-${index}`}
                  label="Image instead of an icon"
                  accept="IMAGE"
                  value={cardMedia?.[str(item["mediaId"])] ?? null}
                  onChange={(picked) => patch({ mediaId: picked?.id ?? "" })}
                />
                <LabelledInput
                  label="Badge"
                  value={str(item["badge"])}
                  onChange={(v) => patch({ badge: v })}
                />
                <LabelledInput
                  label="Title"
                  value={str(item["title"])}
                  onChange={(v) => patch({ title: v })}
                />
                <LabelledTextarea
                  label="Text"
                  value={str(item["text"])}
                  onChange={(v) => patch({ text: v })}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabelledInput
                    label="Button label"
                    value={str(item["ctaLabel"])}
                    onChange={(v) => patch({ ctaLabel: v })}
                  />
                  <LabelledInput
                    label="Button link"
                    value={str(item["ctaHref"])}
                    onChange={(v) => patch({ ctaHref: v })}
                    placeholder="/contact"
                  />
                </div>
                <EnabledToggle item={item} patch={patch} />
              </>
            )}
          </ItemList>
          {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}
        </div>
      );

    case "positioning":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="heading" label="Heading" required error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <StringList
            label="Paragraphs"
            values={list(content["paragraphs"])}
            addLabel="Add paragraph"
            max={8}
            onChange={(next) => set({ paragraphs: next })}
          />
        </div>
      );

    case "process":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="heading" label="Heading" required error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <ItemList
            label="Steps"
            values={items(content["steps"])}
            addLabel="Add step"
            blank={{ title: "", text: "" }}
            max={12}
            onChange={(next) => set({ steps: next })}
          >
            {(item, patch) => (
              <>
                <LabelledInput
                  label="Title"
                  value={str(item["title"])}
                  onChange={(v) => patch({ title: v })}
                />
                <LabelledTextarea
                  label="Text"
                  value={str(item["text"])}
                  onChange={(v) => patch({ text: v })}
                />
              </>
            )}
          </ItemList>
        </div>
      );

    case "industries":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="heading" label="Heading" required error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field id="body" label="Intro" error={err("body")}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={3}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>
          <StringList
            label="Industries"
            values={list(content["items"])}
            addLabel="Add industry"
            max={40}
            onChange={(next) => set({ items: next })}
          />
        </div>
      );

    case "hero":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field
            id="heading"
            label="Heading"
            required
            hint="This is the page's h1."
            error={err("heading")}
          >
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field id="body" label="Body" error={err("body")}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={4}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <LabelledInput
              label="Button label"
              value={str(content["ctaLabel"])}
              onChange={(v) => set({ ctaLabel: v })}
            />
            <LabelledInput
              label="Button link"
              value={str(content["ctaHref"])}
              onChange={(v) => set({ ctaHref: v })}
              placeholder="/contact"
            />
            <LabelledInput
              label="Second button label"
              value={str(content["secondaryLabel"])}
              onChange={(v) => set({ secondaryLabel: v })}
            />
            <LabelledInput
              label="Second button link"
              value={str(content["secondaryHref"])}
              onChange={(v) => set({ secondaryHref: v })}
              placeholder="/case-studies"
            />
          </div>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
              Layout
            </legend>
            <Choice
              id="hero-layout"
              label="Arrangement"
              value={str(content["layout"]) || "stacked"}
              options={[
                ["stacked", "Stacked"],
                ["centered", "Centred"],
                ["text-image", "Text left, image right"],
                ["image-text", "Image left, text right"],
                ["split", "Split"],
              ]}
              onChange={(layout) => set({ layout })}
            />
            <Choice
              id="hero-height"
              label="Height"
              value={str(content["height"]) || "auto"}
              options={[
                ["auto", "Auto"],
                ["sm", "Small"],
                ["md", "Medium"],
                ["lg", "Large"],
                ["screen", "Full viewport"],
              ]}
              onChange={(height) => set({ height })}
            />
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
              Image
            </legend>
            <MediaPicker
              name="mediaId"
              label="Hero image"
              accept="IMAGE"
              value={media}
              onChange={(picked) => set({ mediaId: picked?.id ?? "" })}
              hint="Optional. A hero with no image is a valid hero; a background image lives under Style."
            />
            <LabelledInput
              label="Alt text"
              value={str(content["alt"])}
              onChange={(v) => set({ alt: v })}
            />
            <label className="flex items-center gap-2 text-xs text-navy-800">
              <input
                type="checkbox"
                checked={content["decorative"] === true}
                onChange={(e) => set({ decorative: e.target.checked })}
                className="size-4 accent-[var(--color-brand-red)]"
              />
              Decorative — hide from screen readers
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Choice
                id="hero-image-size"
                label="Image size"
                value={str(content["imageSize"]) || "auto"}
                options={[
                  ["auto", "Auto"],
                  ["sm", "Small"],
                  ["md", "Medium"],
                  ["lg", "Large"],
                ]}
                onChange={(imageSize) => set({ imageSize })}
              />
              <Choice
                id="hero-image-radius"
                label="Corner radius"
                value={str(content["imageRadius"]) || "lg"}
                options={RADII}
                onChange={(imageRadius) => set({ imageRadius })}
              />
            </div>
          </fieldset>

          <ItemList
            label="Facts"
            values={items(content["facts"])}
            addLabel="Add fact"
            blank={{ label: "", value: "" }}
            max={6}
            onChange={(next) => set({ facts: next })}
          >
            {(item, patch) => (
              <div className="grid gap-3 sm:grid-cols-2">
                <LabelledInput
                  label="Label"
                  value={str(item["label"])}
                  onChange={(v) => patch({ label: v })}
                />
                <LabelledInput
                  label="Value"
                  value={str(item["value"])}
                  onChange={(v) => patch({ value: v })}
                />
              </div>
            )}
          </ItemList>
        </div>
      );

    case "textImage":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="heading" label="Heading" required error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field
            id="body"
            label="Body"
            hint="Blank line between paragraphs. **bold**, *italic* and [links](/contact) work."
            error={err("body")}
          >
            {(aria) => (
              <Textarea
                {...aria}
                rows={6}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>
          <StringList
            label="Checklist"
            values={list(content["bullets"])}
            addLabel="Add point"
            max={10}
            onChange={(next) => set({ bullets: next })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <LabelledInput
              label="Button label"
              value={str(content["ctaLabel"])}
              onChange={(v) => set({ ctaLabel: v })}
            />
            <LabelledInput
              label="Button link"
              value={str(content["ctaHref"])}
              onChange={(v) => set({ ctaHref: v })}
              placeholder="/contact"
            />
            <LabelledInput
              label="Second button label"
              value={str(content["secondaryLabel"])}
              onChange={(v) => set({ secondaryLabel: v })}
            />
            <LabelledInput
              label="Second button link"
              value={str(content["secondaryHref"])}
              onChange={(v) => set({ secondaryHref: v })}
              placeholder="/services"
            />
          </div>
          <SideImageFields content={content} set={set} media={media} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              id="ti-valign"
              label="Column alignment"
              value={str(content["verticalAlign"]) || "center"}
              options={[
                ["top", "Top"],
                ["center", "Centre"],
                ["bottom", "Bottom"],
              ]}
              onChange={(verticalAlign) => set({ verticalAlign })}
            />
            <label className="flex items-end gap-2 pb-2 text-xs text-navy-800">
              <input
                type="checkbox"
                checked={content["imageShadow"] === true}
                onChange={(e) => set({ imageShadow: e.target.checked })}
                className="size-4 accent-[var(--color-brand-red)]"
              />
              Lift the image with a shadow
            </label>
          </div>
        </div>
      );

    case "benefits":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field
            id="body"
            label="Description"
            hint="Blank line between paragraphs. **bold**, *italic* and [links](/contact) work."
            error={err("body")}
          >
            {(aria) => (
              <Textarea
                {...aria}
                rows={4}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              id="benefit-icon-style"
              label="Marker style"
              hint="Columns and gaps are on the Grid tab."
              value={str(content["iconStyle"]) || "check"}
              options={[
                ["check", "Icon only"],
                ["circle", "Circle"],
                ["tile", "Tile"],
                ["image", "Image per point"],
                ["none", "No marker"],
              ]}
              onChange={(iconStyle) => set({ iconStyle })}
            />
            <Choice
              id="benefit-icon-color"
              label="Marker colour"
              value={str(content["iconColor"]) || "red"}
              options={ICON_TONES}
              onChange={(iconColor) => set({ iconColor })}
            />
          </div>

          <ItemList
            label="Benefits"
            values={items(content["items"])}
            addLabel="Add benefit"
            blank={{ icon: "check", title: "", text: "", enabled: true }}
            max={24}
            onChange={(next) => set({ items: next })}
          >
            {(item, patch, index) => (
              <>
                <IconSelect
                  id={`benefit-icon-${index}`}
                  value={str(item["icon"])}
                  onChange={(v) => patch({ icon: v })}
                />
                <MediaPicker
                  name={`benefit-media-${index}`}
                  label="Marker image"
                  accept="IMAGE"
                  value={cardMedia?.[str(item["mediaId"])] ?? null}
                  onChange={(picked) => patch({ mediaId: picked?.id ?? "" })}
                  hint="Optional. Replaces the icon for this point."
                />
                <LabelledInput
                  label="Title"
                  value={str(item["title"])}
                  onChange={(v) => patch({ title: v })}
                />
                <LabelledTextarea
                  label="Text"
                  value={str(item["text"])}
                  onChange={(v) => patch({ text: v })}
                />
                <LabelledInput
                  label="Link"
                  value={str(item["href"])}
                  onChange={(v) => patch({ href: v })}
                  placeholder="/services"
                />
                <EnabledToggle item={item} patch={patch} />
              </>
            )}
          </ItemList>
          {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <LabelledInput
              label="Button label"
              value={str(content["ctaLabel"])}
              onChange={(v) => set({ ctaLabel: v })}
            />
            <LabelledInput
              label="Button link"
              value={str(content["ctaHref"])}
              onChange={(v) => set({ ctaHref: v })}
              placeholder="/contact"
            />
          </div>

          <SideImageFields content={content} set={set} media={media} />
        </div>
      );

    case "logoGrid":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field id="body" label="Intro" error={err("body")}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={3}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>
          <Choice
            id="logo-treatment"
            label="Treatment"
            hint="One visual weight reads better on a grid than a wall of brand colours."
            value={str(content["treatment"]) || "muted"}
            options={[
              ["full-colour", "Full colour"],
              ["muted", "Muted, full colour on hover"],
              ["monochrome", "Monochrome, colour on hover"],
            ]}
            onChange={(treatment) => set({ treatment })}
          />
          <ItemList
            label="Logos"
            values={items(content["items"])}
            addLabel="Add logo"
            blank={{ name: "", enabled: true }}
            max={36}
            onChange={(next) => set({ items: next })}
          >
            {(item, patch, index) => (
              <>
                <MediaPicker
                  name={`logo-media-${index}`}
                  label={`Logo ${index + 1}`}
                  accept="IMAGE"
                  value={cardMedia?.[str(item["mediaId"])] ?? null}
                  onChange={(picked) => patch({ mediaId: picked?.id ?? "" })}
                />
                <LabelledInput
                  label="Organisation"
                  value={str(item["name"])}
                  onChange={(v) => patch({ name: v })}
                />
                <LabelledInput
                  label="Alt text"
                  value={str(item["alt"])}
                  onChange={(v) => patch({ alt: v })}
                />
                <LabelledInput
                  label="Link"
                  value={str(item["href"])}
                  onChange={(v) => patch({ href: v })}
                  placeholder="/case-studies"
                />
                <EnabledToggle item={item} patch={patch} />
              </>
            )}
          </ItemList>
          {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}
        </div>
      );

    case "fullWidthImage":
      return (
        <div className="space-y-4">
          <MediaPicker
            name="mediaId"
            label="Image"
            accept="IMAGE"
            value={media}
            onChange={(picked) => set({ mediaId: picked?.id ?? "" })}
          />
          <LabelledInput
            label="Alt text"
            value={str(content["alt"])}
            onChange={(v) => set({ alt: v })}
          />
          <label className="flex items-center gap-2 text-xs text-navy-800">
            <input
              type="checkbox"
              checked={content["decorative"] === true}
              onChange={(e) => set({ decorative: e.target.checked })}
              className="size-4 accent-[var(--color-brand-red)]"
            />
            Decorative — hide from screen readers
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              id="fw-height"
              label="Height"
              value={str(content["height"]) || "md"}
              options={[
                ["auto", "Auto"],
                ["sm", "Small"],
                ["md", "Medium"],
                ["lg", "Large"],
                ["screen", "Full viewport"],
              ]}
              onChange={(height) => set({ height })}
            />
            <Choice
              id="fw-fit"
              label="Image fit"
              value={str(content["fit"]) || "cover"}
              options={FITS}
              onChange={(fit) => set({ fit })}
            />
            <Choice
              id="fw-position"
              label="Image position"
              value={str(content["position"]) || "center"}
              options={POSITIONS}
              onChange={(position) => set({ position })}
            />
            <Choice
              id="fw-overlay"
              label="Tint"
              hint="Copy over an image is only readable with something behind it."
              value={str(content["overlay"]) || "dark"}
              options={OVERLAYS}
              onChange={(overlay) => set({ overlay })}
            />
          </div>

          <Field id="fw-eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="fw-heading" label="Heading over the image" error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field id="fw-body" label="Text over the image" error={err("body")}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={3}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <LabelledInput
              label="Button label"
              value={str(content["ctaLabel"])}
              onChange={(v) => set({ ctaLabel: v })}
            />
            <LabelledInput
              label="Button link"
              value={str(content["ctaHref"])}
              onChange={(v) => set({ ctaHref: v })}
              placeholder="/contact"
            />
          </div>
          <Choice
            id="fw-align"
            label="Text alignment"
            value={str(content["align"]) || "center"}
            options={[
              ["left", "Left"],
              ["center", "Centre"],
              ["right", "Right"],
            ]}
            onChange={(align) => set({ align })}
          />
        </div>
      );

    case "heading":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="text" label="Heading" required error={err("text")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["text"])}
                onChange={(e) => set({ text: e.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="level"
              label="Level"
              hint="The page title is the h1, so a block heading is h2 or h3."
              error={err("level")}
            >
              {(aria) => (
                <Select
                  {...aria}
                  value={String(content["level"] ?? 2)}
                  onChange={(e) => set({ level: Number(e.target.value) })}
                >
                  <option value="2">Heading 2</option>
                  <option value="3">Heading 3</option>
                </Select>
              )}
            </Field>
            <Field id="align" label="Alignment" error={err("align")}>
              {(aria) => (
                <Select
                  {...aria}
                  value={str(content["align"]) || "left"}
                  onChange={(e) => set({ align: e.target.value })}
                >
                  <option value="left">Left</option>
                  <option value="center">Centred</option>
                </Select>
              )}
            </Field>
          </div>
        </div>
      );

    case "richText":
      return (
        <div className="space-y-4">
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field id="body" label="Body" required hint={RICH_TEXT_HINT} error={err("body")}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={10}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>
        </div>
      );

    case "image":
      return (
        <div className="space-y-4">
          <ImageField {...props} />
          {err("mediaId") ? <p className="text-xs text-brand-red-text">{err("mediaId")}</p> : null}
          <Field
            id="alt"
            label="Alt text"
            hint="Leave blank for a purely decorative image."
            error={err("alt")}
          >
            {(aria) => (
              <Input
                {...aria}
                value={str(content["alt"])}
                onChange={(e) => set({ alt: e.target.value })}
              />
            )}
          </Field>
          <Field id="caption" label="Caption" error={err("caption")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["caption"])}
                onChange={(e) => set({ caption: e.target.value })}
              />
            )}
          </Field>
          <Field id="width" label="Width" error={err("width")}>
            {(aria) => (
              <Select
                {...aria}
                value={str(content["width"]) || "container"}
                onChange={(e) => set({ width: e.target.value })}
              >
                <option value="container">Page width</option>
                <option value="wide">Wide</option>
                <option value="full">Full bleed</option>
              </Select>
            )}
          </Field>
        </div>
      );

    case "imageBox":
      return (
        <div className="space-y-4">
          <ImageField {...props} />
          {err("mediaId") ? <p className="text-xs text-brand-red-text">{err("mediaId")}</p> : null}
          <Field id="alt" label="Alt text" error={err("alt")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["alt"])}
                onChange={(e) => set({ alt: e.target.value })}
              />
            )}
          </Field>
          <Field id="title" label="Title" required error={err("title")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["title"])}
                onChange={(e) => set({ title: e.target.value })}
              />
            )}
          </Field>
          <Field id="text" label="Text" error={err("text")}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={3}
                value={str(content["text"])}
                onChange={(e) => set({ text: e.target.value })}
              />
            )}
          </Field>
          <CtaFields content={content} set={set} errors={errors} />
        </div>
      );

    case "imageText":
      return (
        <div className="space-y-4">
          <ImageField {...props} />
          {err("mediaId") ? <p className="text-xs text-brand-red-text">{err("mediaId")}</p> : null}
          <Field id="alt" label="Alt text" error={err("alt")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["alt"])}
                onChange={(e) => set({ alt: e.target.value })}
              />
            )}
          </Field>
          <Field id="imagePosition" label="Image position" error={err("imagePosition")}>
            {(aria) => (
              <Select
                {...aria}
                value={str(content["imagePosition"]) || "left"}
                onChange={(e) => set({ imagePosition: e.target.value })}
              >
                <option value="left">Left of the text</option>
                <option value="right">Right of the text</option>
              </Select>
            )}
          </Field>
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="heading" label="Heading" required error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field id="body" label="Body" hint={RICH_TEXT_HINT} error={err("body")}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={6}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>
          <CtaFields content={content} set={set} errors={errors} />
        </div>
      );

    case "table":
      return (
        <div className="space-y-4">
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field
            id="caption"
            label="Caption"
            hint="Describes the table for someone using a screen reader."
            error={err("caption")}
          >
            {(aria) => (
              <Input
                {...aria}
                value={str(content["caption"])}
                onChange={(e) => set({ caption: e.target.value })}
              />
            )}
          </Field>
          <TableEditor {...props} />
        </div>
      );

    case "feature":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="heading" label="Heading" required error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field id="body" label="Body" hint={RICH_TEXT_HINT} error={err("body")}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={5}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>
          <StringList
            label="Bullets"
            values={list(content["bullets"])}
            addLabel="Add bullet"
            onChange={(next) => set({ bullets: next })}
          />
          <ImageField {...props} label="Image (optional)" />
          <Field id="alt" label="Alt text" error={err("alt")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["alt"])}
                onChange={(e) => set({ alt: e.target.value })}
              />
            )}
          </Field>
          <CtaFields content={content} set={set} errors={errors} />
        </div>
      );

    case "list":
      return (
        <div className="space-y-4">
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field id="style" label="Style" error={err("style")}>
            {(aria) => (
              <Select
                {...aria}
                value={str(content["style"]) || "bulleted"}
                onChange={(e) => set({ style: e.target.value })}
              >
                <option value="bulleted">Bulleted</option>
                <option value="numbered">Numbered</option>
              </Select>
            )}
          </Field>
          <StringList
            label="Items"
            values={list(content["items"])}
            addLabel="Add item"
            max={20}
            onChange={(next) => set({ items: next })}
          />
          {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}
        </div>
      );

    case "textList":
      return (
        <div className="space-y-4">
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <ItemList
            label="Points"
            values={items(content["items"])}
            addLabel="Add point"
            blank={{ title: "", text: "" }}
            max={20}
            onChange={(next) => set({ items: next })}
          >
            {(item, patch) => (
              <>
                <LabelledInput
                  label="Title"
                  value={str(item["title"])}
                  onChange={(v) => patch({ title: v })}
                />
                <LabelledTextarea
                  label="Text"
                  value={str(item["text"])}
                  onChange={(v) => patch({ text: v })}
                />
              </>
            )}
          </ItemList>
          {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}
        </div>
      );

    case "icon":
      return (
        <div className="space-y-4">
          <IconSelect id="icon" value={str(content["icon"])} onChange={(v) => set({ icon: v })} />
          <Field id="heading" label="Heading" required error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field id="body" label="Body" hint={RICH_TEXT_HINT} error={err("body")}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={4}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>
          <Field id="align" label="Alignment" error={err("align")}>
            {(aria) => (
              <Select
                {...aria}
                value={str(content["align"]) || "left"}
                onChange={(e) => set({ align: e.target.value })}
              >
                <option value="left">Left</option>
                <option value="center">Centred</option>
              </Select>
            )}
          </Field>
        </div>
      );

    case "iconCards":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field id="body" label="Intro" error={err("body")}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={3}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              id="cardStyle"
              label="Card style"
              value={str(content["cardStyle"]) || "border"}
              options={CARD_STYLES}
              onChange={(cardStyle) => set({ cardStyle })}
            />
            <Choice
              id="iconStyle"
              label="Icon style"
              value={str(content["iconStyle"]) || "tile"}
              options={[
                ["plain", "Plain"],
                ["tile", "Tile"],
                ["circle", "Circle"],
              ]}
              onChange={(iconStyle) => set({ iconStyle })}
            />
            <Choice
              id="iconSize"
              label="Icon size"
              value={str(content["iconSize"]) || "md"}
              options={[
                ["sm", "Small"],
                ["md", "Medium"],
                ["lg", "Large"],
              ]}
              onChange={(iconSize) => set({ iconSize })}
            />
            <Choice
              id="iconColor"
              label="Icon colour"
              value={str(content["iconColor"]) || "red"}
              options={ICON_TONES}
              onChange={(iconColor) => set({ iconColor })}
            />
          </div>

          <ItemList
            label="Cards"
            values={items(content["items"])}
            addLabel="Add card"
            blank={{ icon: "sparkles", title: "", text: "", enabled: true }}
            max={24}
            onChange={(next) => set({ items: next })}
          >
            {(item, patch, index) => (
              <>
                <IconSelect
                  id={`card-icon-${index}`}
                  value={str(item["icon"])}
                  onChange={(v) => patch({ icon: v })}
                />
                <MediaPicker
                  name={`card-icon-media-${index}`}
                  label="Icon image"
                  accept="IMAGE"
                  value={cardMedia?.[str(item["mediaId"])] ?? null}
                  onChange={(picked) => patch({ mediaId: picked?.id ?? "" })}
                  hint="Optional. Replaces the icon above — for a logo or a custom mark."
                />
                <LabelledInput
                  label="Eyebrow"
                  value={str(item["eyebrow"])}
                  onChange={(v) => patch({ eyebrow: v })}
                />
                <LabelledInput
                  label="Title"
                  value={str(item["title"])}
                  onChange={(v) => patch({ title: v })}
                />
                <LabelledTextarea
                  label="Text"
                  value={str(item["text"])}
                  onChange={(v) => patch({ text: v })}
                />
                <LabelledInput
                  label="Badge"
                  value={str(item["badge"])}
                  onChange={(v) => patch({ badge: v })}
                />
                <LabelledInput
                  label="Link"
                  value={str(item["href"])}
                  onChange={(v) => patch({ href: v })}
                  placeholder="/services"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabelledInput
                    label="Button label"
                    value={str(item["buttonLabel"])}
                    onChange={(v) => patch({ buttonLabel: v })}
                  />
                  <LabelledInput
                    label="Button link"
                    value={str(item["buttonHref"])}
                    onChange={(v) => patch({ buttonHref: v })}
                    placeholder="/contact"
                  />
                </div>
                <EnabledToggle item={item} patch={patch} />
              </>
            )}
          </ItemList>
          {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}
        </div>
      );

    case "imageCards":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["eyebrow"])}
                onChange={(e) => set({ eyebrow: e.target.value })}
              />
            )}
          </Field>
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <CardTreatmentFields content={content} set={set} />
          <ItemList
            label="Cards"
            values={items(content["items"])}
            addLabel="Add card"
            blank={{ title: "", text: "", enabled: true }}
            max={24}
            onChange={(next) => set({ items: next })}
          >
            {(item, patch, index) => (
              <>
                <MediaPicker
                  name={`card-media-${index}`}
                  label={`Card ${index + 1} image`}
                  accept="IMAGE"
                  value={cardMedia?.[str(item["mediaId"])] ?? null}
                  onChange={(picked) => patch({ mediaId: picked?.id ?? "" })}
                />
                <MediaPicker
                  name={`card-hover-${index}`}
                  label="Hover image"
                  accept="IMAGE"
                  value={cardMedia?.[str(item["hoverMediaId"])] ?? null}
                  onChange={(picked) => patch({ hoverMediaId: picked?.id ?? "" })}
                  hint="Optional. Swapped in on hover; decorative, so it carries no alt."
                />
                <LabelledInput
                  label="Alt text"
                  value={str(item["alt"])}
                  onChange={(v) => patch({ alt: v })}
                />
                <LabelledInput
                  label="Eyebrow"
                  value={str(item["eyebrow"])}
                  onChange={(v) => patch({ eyebrow: v })}
                />
                <LabelledInput
                  label="Title"
                  value={str(item["title"])}
                  onChange={(v) => patch({ title: v })}
                />
                <LabelledTextarea
                  label="Text"
                  value={str(item["text"])}
                  onChange={(v) => patch({ text: v })}
                />
                <LabelledInput
                  label="Badge"
                  value={str(item["badge"])}
                  onChange={(v) => patch({ badge: v })}
                />
                <LabelledInput
                  label="Link"
                  value={str(item["href"])}
                  onChange={(v) => patch({ href: v })}
                  placeholder="/case-studies"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <LabelledInput
                    label="Button label"
                    value={str(item["buttonLabel"])}
                    onChange={(v) => patch({ buttonLabel: v })}
                  />
                  <LabelledInput
                    label="Button link"
                    value={str(item["buttonHref"])}
                    onChange={(v) => patch({ buttonHref: v })}
                    placeholder="/contact"
                  />
                </div>
                <EnabledToggle item={item} patch={patch} />
              </>
            )}
          </ItemList>
          {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}
        </div>
      );

    case "cta":
      return (
        <div className="space-y-4">
          <Field id="heading" label="Heading" required error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <Field id="body" label="Body" error={err("body")}>
            {(aria) => (
              <Textarea
                {...aria}
                rows={3}
                value={str(content["body"])}
                onChange={(e) => set({ body: e.target.value })}
              />
            )}
          </Field>
          <CtaFields content={content} set={set} errors={errors} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="secondaryLabel" label="Second button label" error={err("secondaryLabel")}>
              {(aria) => (
                <Input
                  {...aria}
                  value={str(content["secondaryLabel"])}
                  onChange={(e) => set({ secondaryLabel: e.target.value })}
                />
              )}
            </Field>
            <Field id="secondaryHref" label="Second button link" error={err("secondaryHref")}>
              {(aria) => (
                <Input
                  {...aria}
                  value={str(content["secondaryHref"])}
                  onChange={(e) => set({ secondaryHref: e.target.value })}
                  placeholder="/packages"
                />
              )}
            </Field>
          </div>
          <Field id="tone" label="Tone" error={err("tone")}>
            {(aria) => (
              <Select
                {...aria}
                value={str(content["tone"]) || "navy"}
                onChange={(e) => set({ tone: e.target.value })}
              >
                <option value="navy">Navy band</option>
                <option value="light">Light band</option>
              </Select>
            )}
          </Field>
        </div>
      );

    case "faq":
      return (
        <div className="space-y-4">
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["heading"])}
                onChange={(e) => set({ heading: e.target.value })}
              />
            )}
          </Field>
          <ItemList
            label="Questions"
            values={items(content["items"])}
            addLabel="Add question"
            blank={{ question: "", answer: "" }}
            max={30}
            onChange={(next) => set({ items: next })}
          >
            {(item, patch) => (
              <>
                <LabelledInput
                  label="Question"
                  value={str(item["question"])}
                  onChange={(v) => patch({ question: v })}
                />
                <LabelledTextarea
                  label="Answer"
                  rows={4}
                  value={str(item["answer"])}
                  onChange={(v) => patch({ answer: v })}
                  hint={RICH_TEXT_HINT}
                />
              </>
            )}
          </ItemList>
          {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}
        </div>
      );

    case "leadForm":
      return <LeadFormFields content={content} set={set} errors={errors} taxonomy={taxonomy} />;

    case "stickyCta":
      return (
        <div className="space-y-4">
          <Field id="text" label="Message" error={err("text")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["text"])}
                onChange={(e) => set({ text: e.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="channel" label="What the button does" error={err("channel")}>
              {(aria) => (
                <Select
                  {...aria}
                  value={str(content["channel"]) || "link"}
                  onChange={(e) => set({ channel: e.target.value })}
                >
                  <option value="link">Go to a page</option>
                  <option value="whatsapp">Open WhatsApp</option>
                  <option value="phone">Call</option>
                </Select>
              )}
            </Field>
            <Field
              id="target"
              label={
                str(content["channel"]) === "link" || !content["channel"] ? "Page" : "Phone number"
              }
              hint={
                str(content["channel"]) === "link" || !content["channel"]
                  ? "A path on this site, e.g. /contact"
                  : "International format, e.g. +91 98765 43210"
              }
              error={err("target")}
            >
              {(aria) => (
                <Input
                  {...aria}
                  value={str(content["target"])}
                  onChange={(e) => set({ target: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Field id="buttonLabel" label="Button label" error={err("buttonLabel")}>
            {(aria) => (
              <Input
                {...aria}
                value={str(content["buttonLabel"])}
                onChange={(e) => set({ buttonLabel: e.target.value })}
              />
            )}
          </Field>
          {str(content["channel"]) === "whatsapp" ? (
            <Field id="prefill" label="Pre-filled message" error={err("prefill")}>
              {(aria) => (
                <Input
                  {...aria}
                  value={str(content["prefill"])}
                  onChange={(e) => set({ prefill: e.target.value })}
                />
              )}
            </Field>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="position" label="Position" error={err("position")}>
              {(aria) => (
                <Select
                  {...aria}
                  value={str(content["position"]) || "bottom"}
                  onChange={(e) => set({ position: e.target.value })}
                >
                  <option value="bottom">Bottom of the screen</option>
                  <option value="top">Top of the screen</option>
                </Select>
              )}
            </Field>
            <Field
              id="showAfterScroll"
              label="Show after"
              hint="Percent of the page scrolled. 0 shows it straight away."
              error={err("showAfterScroll")}
            >
              {(aria) => (
                <Input
                  {...aria}
                  type="number"
                  min={0}
                  max={90}
                  value={str(content["showAfterScroll"]) || "0"}
                  onChange={(e) => set({ showAfterScroll: e.target.value })}
                />
              )}
            </Field>
            <label className="flex items-end gap-2 pb-2.5 text-sm text-navy-800">
              <input
                type="checkbox"
                checked={content["dismissible"] !== false}
                onChange={(e) => set({ dismissible: e.target.checked })}
                className="h-4 w-4 accent-brand-red"
              />
              Can be dismissed
            </label>
          </div>
        </div>
      );

    case "team":
      return (
        <div className="space-y-4">
          <HeaderFields content={content} set={set} errors={errors} />
          <ItemList
            label="People"
            values={items(content["items"])}
            addLabel="Add person"
            blank={{ name: "", role: "", bio: "" }}
            max={24}
            onChange={(next) => set({ items: next })}
          >
            {(item, patch, index) => (
              <>
                <MediaPicker
                  name={`team-media-${index}`}
                  label="Photograph"
                  accept="IMAGE"
                  value={cardMedia?.[str(item["mediaId"])] ?? null}
                  onChange={(picked) => patch({ mediaId: picked?.id ?? "" })}
                />
                <LabelledInput
                  label="Name"
                  value={str(item["name"])}
                  onChange={(v) => patch({ name: v })}
                />
                <LabelledInput
                  label="Role"
                  value={str(item["role"])}
                  onChange={(v) => patch({ role: v })}
                />
                <LabelledTextarea
                  label="Bio"
                  value={str(item["bio"])}
                  onChange={(v) => patch({ bio: v })}
                />
                <LabelledInput
                  label="Links to"
                  placeholder="/about"
                  value={str(item["linkHref"])}
                  onChange={(v) => patch({ linkHref: v })}
                />
              </>
            )}
          </ItemList>
          {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}
        </div>
      );

    case "gallery":
      return (
        <div className="space-y-4">
          <HeaderFields content={content} set={set} errors={errors} withBody={false} />
          <ItemList
            label="Images"
            values={items(content["items"])}
            addLabel="Add image"
            blank={{ mediaId: "", alt: "", caption: "" }}
            max={48}
            onChange={(next) => set({ items: next })}
          >
            {(item, patch, index) => (
              <>
                <MediaPicker
                  name={`gallery-media-${index}`}
                  label="Image"
                  accept="IMAGE"
                  value={cardMedia?.[str(item["mediaId"])] ?? null}
                  onChange={(picked) => patch({ mediaId: picked?.id ?? "" })}
                />
                <LabelledInput
                  label="Alt text"
                  value={str(item["alt"])}
                  onChange={(v) => patch({ alt: v })}
                />
                <LabelledInput
                  label="Caption"
                  value={str(item["caption"])}
                  onChange={(v) => patch({ caption: v })}
                />
              </>
            )}
          </ItemList>
          {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}
        </div>
      );

    case "video":
      return (
        <div className="space-y-4">
          <HeaderFields content={content} set={set} errors={errors} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="provider" label="Where it is hosted" error={err("provider")}>
              {(aria) => (
                <Select
                  {...aria}
                  value={str(content["provider"]) || "youtube"}
                  onChange={(e) => set({ provider: e.target.value })}
                >
                  <option value="youtube">YouTube</option>
                  <option value="vimeo">Vimeo</option>
                </Select>
              )}
            </Field>
            <Field
              id="video"
              label="Video URL"
              hint="Paste the link from the address bar. The embed is built for you."
              error={err("video")}
            >
              {(aria) => (
                <Input
                  {...aria}
                  value={str(content["video"])}
                  onChange={(e) => set({ video: e.target.value })}
                />
              )}
            </Field>
          </div>
          <Field
            id="title"
            label="Accessible title"
            hint="Read out by screen readers in place of the video frame."
            error={err("title")}
          >
            {(aria) => (
              <Input
                {...aria}
                value={str(content["title"])}
                onChange={(e) => set({ title: e.target.value })}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="ratio" label="Shape" error={err("ratio")}>
              {(aria) => (
                <Select
                  {...aria}
                  value={str(content["ratio"]) || "16:9"}
                  onChange={(e) => set({ ratio: e.target.value })}
                >
                  <option value="16:9">Widescreen</option>
                  <option value="4:3">Classic</option>
                  <option value="1:1">Square</option>
                </Select>
              )}
            </Field>
            <Field id="width" label="Width" error={err("width")}>
              {(aria) => (
                <Select
                  {...aria}
                  value={str(content["width"]) || "container"}
                  onChange={(e) => set({ width: e.target.value })}
                >
                  <option value="container">Container</option>
                  <option value="wide">Wide</option>
                  <option value="full">Full width</option>
                </Select>
              )}
            </Field>
          </div>
        </div>
      );

    case "tabs":
      return (
        <div className="space-y-4">
          <HeaderFields content={content} set={set} errors={errors} withBody={false} />
          <ItemList
            label="Tabs"
            values={items(content["items"])}
            addLabel="Add tab"
            blank={{ label: "", body: "" }}
            max={12}
            onChange={(next) => set({ items: next })}
          >
            {(item, patch) => (
              <>
                <LabelledInput
                  label="Tab label"
                  value={str(item["label"])}
                  onChange={(v) => patch({ label: v })}
                />
                <LabelledTextarea
                  label="Content"
                  rows={5}
                  value={str(item["body"])}
                  onChange={(v) => patch({ body: v })}
                  hint="Blank line for a new paragraph."
                />
              </>
            )}
          </ItemList>
          {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}
        </div>
      );

    case "timeline":
      return (
        <div className="space-y-4">
          <HeaderFields content={content} set={set} errors={errors} withBody={false} />
          <ItemList
            label="Steps"
            values={items(content["items"])}
            addLabel="Add step"
            blank={{ marker: "", title: "", body: "" }}
            max={24}
            onChange={(next) => set({ items: next })}
          >
            {(item, patch) => (
              <>
                <LabelledInput
                  label="Marker"
                  placeholder="01, or a year"
                  value={str(item["marker"])}
                  onChange={(v) => patch({ marker: v })}
                />
                <LabelledInput
                  label="Title"
                  value={str(item["title"])}
                  onChange={(v) => patch({ title: v })}
                />
                <LabelledTextarea
                  label="Text"
                  value={str(item["body"])}
                  onChange={(v) => patch({ body: v })}
                />
              </>
            )}
          </ItemList>
          {err("items") ? <p className="text-xs text-brand-red-text">{err("items")}</p> : null}
        </div>
      );

    case "comparisonTable":
      return <ComparisonFields content={content} set={set} errors={errors} />;
  }
}

/**
 * Eyebrow / heading / body, which most of the newer blocks share.
 *
 * Not applied retroactively to the older cases: rewriting thirty working field
 * sets to save a few lines is exactly the kind of churn CLAUDE.md 2 rule 10
 * warns about.
 */
function HeaderFields({
  content,
  set,
  errors,
  withBody = true,
}: {
  content: Content;
  set: (patch: Content) => void;
  errors: Record<string, string[]> | null;
  withBody?: boolean;
}) {
  const err = useErr(errors);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
          {(aria) => (
            <Input
              {...aria}
              value={str(content["eyebrow"])}
              onChange={(e) => set({ eyebrow: e.target.value })}
            />
          )}
        </Field>
        <Field id="heading" label="Heading" error={err("heading")}>
          {(aria) => (
            <Input
              {...aria}
              value={str(content["heading"])}
              onChange={(e) => set({ heading: e.target.value })}
            />
          )}
        </Field>
      </div>
      {withBody ? (
        <Field id="body" label="Text" error={err("body")}>
          {(aria) => (
            <Textarea
              {...aria}
              rows={3}
              value={str(content["body"])}
              onChange={(e) => set({ body: e.target.value })}
            />
          )}
        </Field>
      ) : null}
    </>
  );
}

function LeadFormFields({
  content,
  set,
  errors,
  taxonomy = EMPTY_TAXONOMY,
}: {
  content: Content;
  set: (patch: Content) => void;
  errors: Record<string, string[]> | null;
  taxonomy?: TaxonomyOptions;
}) {
  const err = useErr(errors);
  const variant = str(content["variant"]) || "lead";

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-line bg-surface-muted px-3 py-2.5 text-xs text-ink-subtle">
        Submissions become leads in the CRM with the visitor&rsquo;s campaign, referrer and device
        attached. Which fields are asked for follows from the type below.
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="variant" label="Form type" error={err("variant")}>
          {(aria) => (
            <Select {...aria} value={variant} onChange={(e) => set({ variant: e.target.value })}>
              <option value="lead">Enquiry — name, email, phone, company, message</option>
              <option value="contact">Contact — name, email, phone, message</option>
              <option value="newsletter">Newsletter — email only</option>
            </Select>
          )}
        </Field>
        <Field id="layout" label="Layout" error={err("layout")}>
          {(aria) => (
            <Select
              {...aria}
              value={str(content["layout"]) || "stacked"}
              onChange={(e) => set({ layout: e.target.value })}
            >
              <option value="stacked">Copy above the form</option>
              <option value="beside">Copy beside the form</option>
            </Select>
          )}
        </Field>
      </div>

      <HeaderFields content={content} set={set} errors={errors} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="submitLabel" label="Button label" error={err("submitLabel")}>
          {(aria) => (
            <Input
              {...aria}
              value={str(content["submitLabel"])}
              onChange={(e) => set({ submitLabel: e.target.value })}
            />
          )}
        </Field>
        <FilterSelect
          id="serviceSlug"
          emptyNote="No services exist yet."
          label="Attach leads to a service"
          emptyLabel="No service"
          value={str(content["serviceSlug"])}
          options={taxonomy.services}
          onChange={(serviceSlug) => set({ serviceSlug })}
        />
      </div>

      <Field id="successMessage" label="Message after sending" error={err("successMessage")}>
        {(aria) => (
          <Textarea
            {...aria}
            rows={2}
            value={str(content["successMessage"])}
            onChange={(e) => set({ successMessage: e.target.value })}
          />
        )}
      </Field>

      <Field
        id="consentText"
        label="Small print"
        hint="Shown beside the button."
        error={err("consentText")}
      >
        {(aria) => (
          <Input
            {...aria}
            value={str(content["consentText"])}
            onChange={(e) => set({ consentText: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}

function ComparisonFields({
  content,
  set,
  errors,
}: {
  content: Content;
  set: (patch: Content) => void;
  errors: Record<string, string[]> | null;
}) {
  const err = useErr(errors);
  const columns = items(content["columns"]);
  const rows = items(content["rows"]);

  const cellsOf = (row: Content): (boolean | string)[] =>
    Array.isArray(row["cells"])
      ? (row["cells"] as unknown[]).map((cell) => (typeof cell === "boolean" ? cell : str(cell)))
      : [];

  const setCell = (rowIndex: number, columnIndex: number, value: boolean | string) => {
    set({
      rows: rows.map((row, index) => {
        if (index !== rowIndex) return row;
        const cells = cellsOf(row);
        while (cells.length < columns.length) cells.push("");
        cells[columnIndex] = value;
        return { ...row, cells };
      }),
    });
  };

  return (
    <div className="space-y-4">
      <HeaderFields content={content} set={set} errors={errors} />

      <ItemList
        label="Columns"
        values={columns}
        addLabel="Add column"
        blank={{ label: "", detail: "", highlight: false }}
        max={5}
        onChange={(next) => set({ columns: next })}
      >
        {(item, patch) => (
          <>
            <LabelledInput
              label="Label"
              value={str(item["label"])}
              onChange={(v) => patch({ label: v })}
            />
            <LabelledInput
              label="Detail"
              value={str(item["detail"])}
              onChange={(v) => patch({ detail: v })}
            />
            <LabelledInput
              label="Button label"
              value={str(item["ctaLabel"])}
              onChange={(v) => patch({ ctaLabel: v })}
            />
            <LabelledInput
              label="Button goes to"
              placeholder="/contact"
              value={str(item["ctaHref"])}
              onChange={(v) => patch({ ctaHref: v })}
            />
            <label className="flex items-center gap-2 text-xs text-navy-800">
              <input
                type="checkbox"
                checked={item["highlight"] === true}
                onChange={(e) => patch({ highlight: e.target.checked })}
                className="h-3.5 w-3.5 accent-brand-red"
              />
              Highlight this column
            </label>
          </>
        )}
      </ItemList>
      {err("columns") ? <p className="text-xs text-brand-red-text">{err("columns")}</p> : null}

      <div>
        <p className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Rows</p>
        <div className="space-y-3">
          {rows.map((row, rowIndex) => {
            const cells = cellsOf(row);
            return (
              <div key={rowIndex} className="rounded-md border border-line bg-surface-muted p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <LabelledInput
                      label={`Row ${rowIndex + 1}`}
                      value={str(row["label"])}
                      onChange={(v) =>
                        set({ rows: rows.map((r, i) => (i === rowIndex ? { ...r, label: v } : r)) })
                      }
                    />
                    <div className="grid gap-2 sm:grid-cols-2">
                      {columns.map((column, columnIndex) => {
                        const value = cells[columnIndex] ?? "";
                        const mode = value === true ? "yes" : value === false ? "no" : "text";
                        return (
                          <div key={columnIndex} className="flex items-end gap-2">
                            <label className="block flex-1">
                              <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-subtle">
                                {str(column["label"]) || `Column ${columnIndex + 1}`}
                              </span>
                              <Select
                                value={mode}
                                aria-label={`${str(column["label"])} for row ${rowIndex + 1}`}
                                onChange={(e) =>
                                  setCell(
                                    rowIndex,
                                    columnIndex,
                                    e.target.value === "yes"
                                      ? true
                                      : e.target.value === "no"
                                        ? false
                                        : "",
                                  )
                                }
                              >
                                <option value="yes">Included</option>
                                <option value="no">Not included</option>
                                <option value="text">Text</option>
                              </Select>
                            </label>
                            {mode === "text" ? (
                              <Input
                                aria-label={`Text for ${str(column["label"])}, row ${rowIndex + 1}`}
                                value={typeof value === "string" ? value : ""}
                                onChange={(e) => setCell(rowIndex, columnIndex, e.target.value)}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove row ${rowIndex + 1}`}
                    onClick={() => set({ rows: rows.filter((_, i) => i !== rowIndex) })}
                    className="mt-6 rounded-sm p-1.5 text-ink-subtle hover:text-brand-red"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {rows.length < 40 ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => set({ rows: [...rows, { label: "", cells: columns.map(() => false) }] })}
          >
            <Plus size={13} aria-hidden="true" />
            Add row
          </Button>
        ) : null}
        {err("rows") ? <p className="mt-1 text-xs text-brand-red-text">{err("rows")}</p> : null}
      </div>
    </div>
  );
}

function CtaFields({
  content,
  set,
  errors,
}: {
  content: Content;
  set: (patch: Content) => void;
  errors: Record<string, string[]> | null;
}) {
  const err = useErr(errors);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id="ctaLabel" label="Button label" error={err("ctaLabel")}>
        {(aria) => (
          <Input
            {...aria}
            value={str(content["ctaLabel"])}
            onChange={(e) => set({ ctaLabel: e.target.value })}
          />
        )}
      </Field>
      <Field
        id="ctaHref"
        label="Button link"
        hint="A path on this site, e.g. /contact"
        error={err("ctaHref")}
      >
        {(aria) => (
          <Input
            {...aria}
            value={str(content["ctaHref"])}
            onChange={(e) => set({ ctaHref: e.target.value })}
            placeholder="/contact"
          />
        )}
      </Field>
    </div>
  );
}

/**
 * Repeating items with their own fields: text-list points, icon cards, image
 * cards, FAQ entries.
 *
 * Reordering here is buttons only. These lists are short and live inside a
 * modal already holding a drag surface behind it; a second drag context would
 * be ambiguous to use and worse to reach by keyboard.
 */
function ItemList({
  label,
  values,
  onChange,
  addLabel,
  blank,
  max,
  children,
}: {
  label: string;
  values: Content[];
  onChange: (next: Content[]) => void;
  addLabel: string;
  blank: Content;
  max: number;
  children: (item: Content, patch: (p: Content) => void, index: number) => React.ReactNode;
}) {
  const patchAt = (index: number) => (p: Content) => {
    const next = values.map((item, i) => (i === index ? { ...item, ...p } : item));
    onChange(next);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= values.length) return;
    const next = [...values];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <fieldset>
      <legend className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </legend>
      <ol className="space-y-3">
        {values.map((item, index) => (
          <li key={index} className="rounded-md border border-line bg-surface-muted/50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                {index + 1}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  aria-label={`Move ${label} ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                  className="rounded-sm p-1 text-ink-subtle hover:text-navy-800 disabled:opacity-30"
                >
                  <ChevronUp size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${label} ${index + 1} down`}
                  disabled={index === values.length - 1}
                  onClick={() => move(index, index + 1)}
                  className="rounded-sm p-1 text-ink-subtle hover:text-navy-800 disabled:opacity-30"
                >
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${label} ${index + 1}`}
                  onClick={() => onChange(values.filter((_, i) => i !== index))}
                  className="rounded-sm p-1 text-ink-subtle hover:text-brand-red"
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="space-y-3">{children(item, patchAt(index), index)}</div>
          </li>
        ))}
      </ol>
      {values.length < max ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-2.5"
          onClick={() => onChange([...values, { ...blank }])}
        >
          <Plus size={13} aria-hidden="true" />
          {addLabel}
        </Button>
      ) : null}
    </fieldset>
  );
}

function IconSelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (next: string) => void;
  id: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
        Icon
      </span>
      <Select id={id} value={value || "sparkles"} onChange={(e) => onChange(e.target.value)}>
        {ICON_NAMES.map((name) => (
          <option key={name} value={name}>
            {ICON_LABELS[name]}
          </option>
        ))}
      </Select>
    </label>
  );
}

function LabelledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

function LabelledTextarea({
  label,
  value,
  onChange,
  rows = 3,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </span>
      <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="mt-1 block text-2xs text-ink-subtle">{hint}</span> : null}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Shared controls for the layout blocks
// ---------------------------------------------------------------------------

type Option = readonly [value: string, label: string];

const CARD_STYLES: readonly Option[] = [
  ["flat", "Flat"],
  ["border", "Border"],
  ["shadow", "Shadow"],
  ["elevated", "Elevated"],
  ["glass", "Glass"],
];

const ICON_TONES: readonly Option[] = [
  ["red", "Red"],
  ["navy", "Navy"],
  ["muted", "Muted"],
];

const ASPECTS: readonly Option[] = [
  ["auto", "Auto"],
  ["1:1", "Square (1:1)"],
  ["4:3", "4:3"],
  ["3:2", "3:2"],
  ["16:9", "16:9"],
  ["21:9", "21:9"],
];

const FITS: readonly Option[] = [
  ["cover", "Cover"],
  ["contain", "Contain"],
];

const POSITIONS: readonly Option[] = [
  ["center", "Centre"],
  ["top", "Top"],
  ["bottom", "Bottom"],
  ["left", "Left"],
  ["right", "Right"],
];

const RADII: readonly Option[] = [
  ["none", "None"],
  ["sm", "Small"],
  ["md", "Medium"],
  ["lg", "Large"],
  ["full", "Fully rounded"],
];

const OVERLAYS: readonly Option[] = [
  ["none", "None"],
  ["dark", "Dark"],
  ["light", "Light"],
];

const SPLITS: readonly Option[] = [
  ["50/50", "50 / 50"],
  ["40/60", "40 / 60"],
  ["60/40", "60 / 40"],
  ["35/65", "35 / 65"],
  ["65/35", "65 / 35"],
];

const SIDES: readonly Option[] = [
  ["right", "Image right, text left"],
  ["left", "Image left, text right"],
];

function Choice({
  id,
  label,
  hint,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  options: readonly Option[];
  onChange: (next: string) => void;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      {(aria) => (
        <Select {...aria} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map(([optionValue, optionLabel]) => (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/**
 * Hide one item without deleting it.
 *
 * The same distinction the section list already draws: a hidden card keeps its
 * content and its position, and stops reaching the public page.
 */
function EnabledToggle({ item, patch }: { item: Content; patch: (p: Content) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-navy-800">
      <input
        type="checkbox"
        checked={item["enabled"] !== false}
        onChange={(e) => patch({ enabled: e.target.checked })}
        className="size-4 accent-[var(--color-brand-red)]"
      />
      Show this one on the page
    </label>
  );
}

/** How a card block presents its images. Edits the shared `image` object. */
function CardTreatmentFields({
  content,
  set,
}: {
  content: Content;
  set: (patch: Content) => void;
}) {
  const image = (content["image"] ?? {}) as Content;
  const patch = (next: Content) => set({ image: { ...image, ...next } });

  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
        Card images
      </legend>
      <Choice
        id="cardStyle"
        label="Card style"
        value={str(content["cardStyle"]) || "border"}
        options={CARD_STYLES}
        onChange={(cardStyle) => set({ cardStyle })}
      />
      <Choice
        id="image-aspect"
        label="Aspect ratio"
        value={str(image["aspect"]) || "4:3"}
        options={ASPECTS}
        onChange={(aspect) => patch({ aspect })}
      />
      <Choice
        id="image-fit"
        label="Image fit"
        value={str(image["fit"]) || "cover"}
        options={FITS}
        onChange={(fit) => patch({ fit })}
      />
      <Choice
        id="image-position"
        label="Image position"
        value={str(image["position"]) || "center"}
        options={POSITIONS}
        onChange={(position) => patch({ position })}
      />
      <Choice
        id="image-radius"
        label="Corner radius"
        value={str(image["radius"]) || "md"}
        options={RADII}
        onChange={(radius) => patch({ radius })}
      />
      <Choice
        id="image-overlay"
        label="Image tint"
        value={str(image["overlay"]) || "none"}
        options={OVERLAYS}
        onChange={(overlay) => patch({ overlay })}
      />
    </fieldset>
  );
}

/** The side image shared by Text-and-image and Benefits. */
function SideImageFields({
  content,
  set,
  media,
}: {
  content: Content;
  set: (patch: Content) => void;
  media: PickedMedia | null;
}) {
  const image = (content["image"] ?? {}) as Content;
  const patchImage = (next: Content) => set({ image: { ...image, ...next } });

  return (
    <fieldset className="space-y-4">
      <legend className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
        Image
      </legend>
      <MediaPicker
        name="mediaId"
        label="Image"
        accept="IMAGE"
        value={media}
        onChange={(picked) => set({ mediaId: picked?.id ?? "" })}
        hint="Optional. The section lays out full width without one."
      />
      <LabelledInput
        label="Alt text"
        value={str(content["alt"])}
        onChange={(v) => set({ alt: v })}
      />
      <label className="flex items-center gap-2 text-xs text-navy-800">
        <input
          type="checkbox"
          checked={content["decorative"] === true}
          onChange={(e) => set({ decorative: e.target.checked })}
          className="size-4 accent-[var(--color-brand-red)]"
        />
        Decorative — hide from screen readers, because the copy already says it
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Choice
          id="imageSide"
          label="Layout"
          value={str(content["imageSide"]) || "right"}
          options={SIDES}
          onChange={(imageSide) => set({ imageSide })}
        />
        <Choice
          id="split"
          label="Width split"
          hint="Text first."
          value={str(content["split"]) || "50/50"}
          options={SPLITS}
          onChange={(split) => set({ split })}
        />
        <Choice
          id="side-aspect"
          label="Aspect ratio"
          value={str(image["aspect"]) || "4:3"}
          options={ASPECTS}
          onChange={(aspect) => patchImage({ aspect })}
        />
        <Choice
          id="side-fit"
          label="Image fit"
          value={str(image["fit"]) || "cover"}
          options={FITS}
          onChange={(fit) => patchImage({ fit })}
        />
        <Choice
          id="side-position"
          label="Image position"
          value={str(image["position"]) || "center"}
          options={POSITIONS}
          onChange={(position) => patchImage({ position })}
        />
        <Choice
          id="side-radius"
          label="Corner radius"
          value={str(image["radius"]) || "md"}
          options={RADII}
          onChange={(radius) => patchImage({ radius })}
        />
      </div>
    </fieldset>
  );
}

/**
 * The shared editor for every dynamic collection block.
 *
 * All five choose rows the same way — a mode, an optional hand-picked list, a
 * limit — so they share one form. What differs between them is the label on the
 * "how many" field and whether a layout choice exists, which is a table, not
 * five editors.
 *
 * There is deliberately no field for a service's name or a package's price:
 * those live on the entity, and a copy here would be a second version of the
 * truth that drifts (CLAUDE.md 2 rule 5).
 */
const COLLECTION_LABELS: Record<
  string,
  { noun: string; layouts?: readonly Option[]; hint: string }
> = {
  serviceGrid: {
    noun: "services",
    layouts: [
      ["index", "Editorial index"],
      ["cards", "Cards"],
    ],
    hint: "Published services, in their own order.",
  },
  packageGrid: { noun: "packages", hint: "Published packages, with live prices." },
  blogGrid: {
    noun: "posts",
    layouts: [
      ["index", "List"],
      ["cards", "Cards"],
    ],
    hint: "Published posts, newest first.",
  },
  caseStudyGrid: {
    noun: "case studies",
    layouts: [
      ["editorial", "One large, the rest beneath"],
      ["cards", "Cards"],
    ],
    hint: "Published case studies.",
  },
  testimonials: {
    noun: "testimonials",
    layouts: [
      ["quotes", "Pull quotes"],
      ["cards", "Cards"],
    ],
    hint: "Published testimonials.",
  },
};

/**
 * A filter picker.
 *
 * Always offers "Everything" as the blank value, because a filter an editor has
 * not chosen must match everything rather than nothing. When the list is empty
 * it says so instead of rendering a select with one useless option.
 */
function FilterSelect({
  id,
  label,
  value,
  options,
  emptyLabel,
  emptyNote,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly TaxonomyOption[];
  /** What "no filter" reads as. Always offered, because blank means everything. */
  emptyLabel: string;
  /** What to say when there is nothing to choose from at all. */
  emptyNote: string;
  onChange: (next: string) => void;
}) {
  if (options.length === 0) {
    return (
      <Field id={id} label={label}>
        {() => <p className="text-xs text-ink-subtle">{emptyNote}</p>}
      </Field>
    );
  }
  return (
    <Field id={id} label={label}>
      {(aria) => (
        <Select {...aria} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{emptyLabel}</option>
          {options.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function CollectionFields({
  type,
  content,
  set,
  errors,
  taxonomy = EMPTY_TAXONOMY,
}: {
  type: string;
  content: Content;
  set: (patch: Content) => void;
  errors: Record<string, string[]> | null;
  taxonomy?: TaxonomyOptions;
}) {
  const err = useErr(errors);
  const meta = COLLECTION_LABELS[type] ?? { noun: "items", hint: "" };
  const mode = str(content["mode"]) || "latest";

  return (
    <div className="space-y-4">
      <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-xs text-ink-subtle">
        {meta.hint} Content comes from the records themselves, so nothing here can show something
        unpublished — and a change made on the record reaches this section.
      </p>

      <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
        {(aria) => (
          <Input
            {...aria}
            value={str(content["eyebrow"])}
            onChange={(e) => set({ eyebrow: e.target.value })}
          />
        )}
      </Field>
      <Field id="heading" label="Heading" error={err("heading")}>
        {(aria) => (
          <Input
            {...aria}
            value={str(content["heading"])}
            onChange={(e) => set({ heading: e.target.value })}
          />
        )}
      </Field>
      <Field id="body" label="Intro" error={err("body")}>
        {(aria) => (
          <Textarea
            {...aria}
            rows={3}
            value={str(content["body"])}
            onChange={(e) => set({ body: e.target.value })}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Choice
          id="collection-mode"
          label="Which ones"
          value={mode}
          options={[
            ["latest", "Most recent"],
            ["featured", "In their own order"],
            ["manual", "Chosen by hand"],
          ]}
          onChange={(next) => set({ mode: next })}
        />
        <Field id="collection-limit" label={`How many ${meta.noun}`} error={err("limit")}>
          {(aria) => (
            <Input
              {...aria}
              type="number"
              min={1}
              max={24}
              value={String(content["limit"] ?? 6)}
              onChange={(e) => set({ limit: Number(e.target.value) })}
            />
          )}
        </Field>
      </div>

      {mode === "manual" ? (
        <StringList
          label={`Chosen ${meta.noun}, by ID, in order`}
          values={list(content["ids"])}
          addLabel="Add one"
          max={24}
          onChange={(next) => set({ ids: next })}
        />
      ) : null}

      {meta.layouts ? (
        <Choice
          id="collection-layout"
          label="Layout"
          value={str(content["layout"]) || (meta.layouts[0]?.[0] ?? "")}
          options={meta.layouts}
          onChange={(layout) => set({ layout })}
        />
      ) : null}

      {mode !== "manual" ? (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
            Narrow it down
          </legend>

          {type === "blogGrid" ? (
            <>
              <FilterSelect
                id="categorySlug"
                emptyNote="No blog categories exist yet."
                label="Category"
                emptyLabel="Every category"
                value={str(content["categorySlug"])}
                options={taxonomy.categories}
                onChange={(categorySlug) => set({ categorySlug })}
              />
              <FilterSelect
                id="tagSlug"
                emptyNote="No blog tags exist yet."
                label="Tag"
                emptyLabel="Every tag"
                value={str(content["tagSlug"])}
                options={taxonomy.tags}
                onChange={(tagSlug) => set({ tagSlug })}
              />
              <Field id="blog-sort" label="Order">
                {(aria) => (
                  <Select
                    {...aria}
                    value={str(content["sort"]) || "newest"}
                    onChange={(e) => set({ sort: e.target.value })}
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                  </Select>
                )}
              </Field>
            </>
          ) : null}

          {type === "caseStudyGrid" || type === "testimonials" ? (
            <>
              <FilterSelect
                id="serviceSlug"
                emptyNote="No services exist yet."
                label="Service"
                emptyLabel="Every service"
                value={str(content["serviceSlug"])}
                options={taxonomy.services}
                onChange={(serviceSlug) => set({ serviceSlug })}
              />
              <FilterSelect
                id="citySlug"
                emptyNote="No cities exist yet."
                label="City"
                emptyLabel="Every city"
                value={str(content["citySlug"])}
                options={taxonomy.cities}
                onChange={(citySlug) => set({ citySlug })}
              />
            </>
          ) : null}

          {type === "testimonials" ? (
            <Field
              id="minRating"
              label="Minimum rating"
              hint="Testimonials with no rating are left out once this is set."
            >
              {(aria) => (
                <Select
                  {...aria}
                  value={str(content["minRating"])}
                  onChange={(e) =>
                    set({ minRating: e.target.value === "" ? undefined : e.target.value })
                  }
                >
                  <option value="">Any rating</option>
                  {[5, 4, 3].map((value) => (
                    <option key={value} value={value}>
                      {value} stars and up
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          {type === "packageGrid" ? (
            <>
              <FilterSelect
                id="serviceSlug"
                emptyNote="No services exist yet."
                label="Service"
                emptyLabel="Every service"
                value={str(content["serviceSlug"])}
                options={taxonomy.services}
                onChange={(serviceSlug) => set({ serviceSlug })}
              />
              <label className="flex items-end gap-2 pb-2.5 text-sm text-navy-800">
                <input
                  type="checkbox"
                  checked={content["recommendedOnly"] === true}
                  onChange={(e) => set({ recommendedOnly: e.target.checked })}
                  className="h-4 w-4 accent-brand-red"
                />
                Recommended packages only
              </label>
            </>
          ) : null}

          {type === "serviceGrid" ? (
            <Field id="service-sort" label="Order">
              {(aria) => (
                <Select
                  {...aria}
                  value={str(content["sort"]) || "order"}
                  onChange={(e) => set({ sort: e.target.value })}
                >
                  <option value="order">The order set on each service</option>
                  <option value="name">Alphabetical</option>
                </Select>
              )}
            </Field>
          ) : null}
        </fieldset>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <LabelledInput
          label="Link label"
          value={str(content["linkLabel"])}
          onChange={(v) => set({ linkLabel: v })}
          placeholder="See everything"
        />
        <LabelledInput
          label="Link URL"
          value={str(content["linkHref"])}
          onChange={(v) => set({ linkHref: v })}
          placeholder="/services"
        />
      </div>
    </div>
  );
}
