"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { MediaPicker, type PickedMedia } from "@/components/admin/media-picker";
import { ICON_LABELS, ICON_NAMES } from "@/lib/content/icons";
import type { BlockType } from "@/lib/content/blocks";

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
};

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(str) : []);
const grid = (value: unknown): string[][] =>
  Array.isArray(value) ? value.map((row) => list(row)) : [];
const items = (value: unknown): Content[] =>
  Array.isArray(value) ? value.map((item) => (item && typeof item === "object" ? { ...(item as Content) } : {})) : [];

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
            rows: rows.map((row) =>
              Array.from({ length: next.length }, (_, i) => row[i] ?? ""),
            ),
          });
        }}
      />
      {err("headers") ? <p className="text-xs text-brand-red-text">{err("headers")}</p> : null}

      <div>
        <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-ink-subtle">Rows</p>
        <div className="space-y-2">
          {rows.map((row, r) => (
            <div key={r} className="flex items-start gap-2">
              <div className="grid flex-1 gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, headers.length)}, minmax(0, 1fr))` }}>
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
            onClick={() => set({ rows: [...rows, Array.from({ length: headers.length }, () => "")] })}
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
  const { content, set, errors, cardMedia } = props;
  const err = useErr(errors);

  switch (type) {
    case "heading":
      return (
        <div className="space-y-4">
          <Field id="eyebrow" label="Eyebrow" error={err("eyebrow")}>
            {(aria) => (
              <Input {...aria} value={str(content["eyebrow"])} onChange={(e) => set({ eyebrow: e.target.value })} />
            )}
          </Field>
          <Field id="text" label="Heading" required error={err("text")}>
            {(aria) => (
              <Input {...aria} value={str(content["text"])} onChange={(e) => set({ text: e.target.value })} />
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
                <Select {...aria} value={str(content["align"]) || "left"} onChange={(e) => set({ align: e.target.value })}>
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
              <Input {...aria} value={str(content["heading"])} onChange={(e) => set({ heading: e.target.value })} />
            )}
          </Field>
          <Field id="body" label="Body" required hint={RICH_TEXT_HINT} error={err("body")}>
            {(aria) => (
              <Textarea {...aria} rows={10} value={str(content["body"])} onChange={(e) => set({ body: e.target.value })} />
            )}
          </Field>
        </div>
      );

    case "image":
      return (
        <div className="space-y-4">
          <ImageField {...props} />
          {err("mediaId") ? <p className="text-xs text-brand-red-text">{err("mediaId")}</p> : null}
          <Field id="alt" label="Alt text" hint="Leave blank for a purely decorative image." error={err("alt")}>
            {(aria) => <Input {...aria} value={str(content["alt"])} onChange={(e) => set({ alt: e.target.value })} />}
          </Field>
          <Field id="caption" label="Caption" error={err("caption")}>
            {(aria) => (
              <Input {...aria} value={str(content["caption"])} onChange={(e) => set({ caption: e.target.value })} />
            )}
          </Field>
          <Field id="width" label="Width" error={err("width")}>
            {(aria) => (
              <Select {...aria} value={str(content["width"]) || "container"} onChange={(e) => set({ width: e.target.value })}>
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
            {(aria) => <Input {...aria} value={str(content["alt"])} onChange={(e) => set({ alt: e.target.value })} />}
          </Field>
          <Field id="title" label="Title" required error={err("title")}>
            {(aria) => <Input {...aria} value={str(content["title"])} onChange={(e) => set({ title: e.target.value })} />}
          </Field>
          <Field id="text" label="Text" error={err("text")}>
            {(aria) => (
              <Textarea {...aria} rows={3} value={str(content["text"])} onChange={(e) => set({ text: e.target.value })} />
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
            {(aria) => <Input {...aria} value={str(content["alt"])} onChange={(e) => set({ alt: e.target.value })} />}
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
              <Input {...aria} value={str(content["eyebrow"])} onChange={(e) => set({ eyebrow: e.target.value })} />
            )}
          </Field>
          <Field id="heading" label="Heading" required error={err("heading")}>
            {(aria) => (
              <Input {...aria} value={str(content["heading"])} onChange={(e) => set({ heading: e.target.value })} />
            )}
          </Field>
          <Field id="body" label="Body" hint={RICH_TEXT_HINT} error={err("body")}>
            {(aria) => (
              <Textarea {...aria} rows={6} value={str(content["body"])} onChange={(e) => set({ body: e.target.value })} />
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
              <Input {...aria} value={str(content["heading"])} onChange={(e) => set({ heading: e.target.value })} />
            )}
          </Field>
          <Field
            id="caption"
            label="Caption"
            hint="Describes the table for someone using a screen reader."
            error={err("caption")}
          >
            {(aria) => (
              <Input {...aria} value={str(content["caption"])} onChange={(e) => set({ caption: e.target.value })} />
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
              <Input {...aria} value={str(content["eyebrow"])} onChange={(e) => set({ eyebrow: e.target.value })} />
            )}
          </Field>
          <Field id="heading" label="Heading" required error={err("heading")}>
            {(aria) => (
              <Input {...aria} value={str(content["heading"])} onChange={(e) => set({ heading: e.target.value })} />
            )}
          </Field>
          <Field id="body" label="Body" hint={RICH_TEXT_HINT} error={err("body")}>
            {(aria) => (
              <Textarea {...aria} rows={5} value={str(content["body"])} onChange={(e) => set({ body: e.target.value })} />
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
            {(aria) => <Input {...aria} value={str(content["alt"])} onChange={(e) => set({ alt: e.target.value })} />}
          </Field>
          <CtaFields content={content} set={set} errors={errors} />
        </div>
      );

    case "list":
      return (
        <div className="space-y-4">
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input {...aria} value={str(content["heading"])} onChange={(e) => set({ heading: e.target.value })} />
            )}
          </Field>
          <Field id="style" label="Style" error={err("style")}>
            {(aria) => (
              <Select {...aria} value={str(content["style"]) || "bulleted"} onChange={(e) => set({ style: e.target.value })}>
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
              <Input {...aria} value={str(content["heading"])} onChange={(e) => set({ heading: e.target.value })} />
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
                <LabelledInput label="Title" value={str(item["title"])} onChange={(v) => patch({ title: v })} />
                <LabelledTextarea label="Text" value={str(item["text"])} onChange={(v) => patch({ text: v })} />
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
              <Input {...aria} value={str(content["heading"])} onChange={(e) => set({ heading: e.target.value })} />
            )}
          </Field>
          <Field id="body" label="Body" hint={RICH_TEXT_HINT} error={err("body")}>
            {(aria) => (
              <Textarea {...aria} rows={4} value={str(content["body"])} onChange={(e) => set({ body: e.target.value })} />
            )}
          </Field>
          <Field id="align" label="Alignment" error={err("align")}>
            {(aria) => (
              <Select {...aria} value={str(content["align"]) || "left"} onChange={(e) => set({ align: e.target.value })}>
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
              <Input {...aria} value={str(content["eyebrow"])} onChange={(e) => set({ eyebrow: e.target.value })} />
            )}
          </Field>
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input {...aria} value={str(content["heading"])} onChange={(e) => set({ heading: e.target.value })} />
            )}
          </Field>
          <Field id="columns" label="Columns" hint="Always one column on a phone." error={err("columns")}>
            {(aria) => (
              <Select {...aria} value={String(content["columns"] ?? 3)} onChange={(e) => set({ columns: Number(e.target.value) })}>
                <option value="2">Two</option>
                <option value="3">Three</option>
                <option value="4">Four</option>
              </Select>
            )}
          </Field>
          <ItemList
            label="Cards"
            values={items(content["items"])}
            addLabel="Add card"
            blank={{ icon: "sparkles", title: "", text: "" }}
            max={12}
            onChange={(next) => set({ items: next })}
          >
            {(item, patch, index) => (
              <>
                <IconSelect id={`icon-${index}`} value={str(item["icon"])} onChange={(v) => patch({ icon: v })} />
                <LabelledInput label="Title" value={str(item["title"])} onChange={(v) => patch({ title: v })} />
                <LabelledTextarea label="Text" value={str(item["text"])} onChange={(v) => patch({ text: v })} />
                <LabelledInput label="Link" value={str(item["href"])} onChange={(v) => patch({ href: v })} placeholder="/services" />
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
              <Input {...aria} value={str(content["eyebrow"])} onChange={(e) => set({ eyebrow: e.target.value })} />
            )}
          </Field>
          <Field id="heading" label="Heading" error={err("heading")}>
            {(aria) => (
              <Input {...aria} value={str(content["heading"])} onChange={(e) => set({ heading: e.target.value })} />
            )}
          </Field>
          <Field id="columns" label="Columns" hint="Always one column on a phone." error={err("columns")}>
            {(aria) => (
              <Select {...aria} value={String(content["columns"] ?? 3)} onChange={(e) => set({ columns: Number(e.target.value) })}>
                <option value="2">Two</option>
                <option value="3">Three</option>
              </Select>
            )}
          </Field>
          <ItemList
            label="Cards"
            values={items(content["items"])}
            addLabel="Add card"
            blank={{ title: "", text: "" }}
            max={12}
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
                <LabelledInput label="Alt text" value={str(item["alt"])} onChange={(v) => patch({ alt: v })} />
                <LabelledInput label="Title" value={str(item["title"])} onChange={(v) => patch({ title: v })} />
                <LabelledTextarea label="Text" value={str(item["text"])} onChange={(v) => patch({ text: v })} />
                <LabelledInput label="Link" value={str(item["href"])} onChange={(v) => patch({ href: v })} placeholder="/case-studies" />
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
              <Input {...aria} value={str(content["heading"])} onChange={(e) => set({ heading: e.target.value })} />
            )}
          </Field>
          <Field id="body" label="Body" error={err("body")}>
            {(aria) => (
              <Textarea {...aria} rows={3} value={str(content["body"])} onChange={(e) => set({ body: e.target.value })} />
            )}
          </Field>
          <CtaFields content={content} set={set} errors={errors} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="secondaryLabel" label="Second button label" error={err("secondaryLabel")}>
              {(aria) => (
                <Input {...aria} value={str(content["secondaryLabel"])} onChange={(e) => set({ secondaryLabel: e.target.value })} />
              )}
            </Field>
            <Field id="secondaryHref" label="Second button link" error={err("secondaryHref")}>
              {(aria) => (
                <Input {...aria} value={str(content["secondaryHref"])} onChange={(e) => set({ secondaryHref: e.target.value })} placeholder="/packages" />
              )}
            </Field>
          </div>
          <Field id="tone" label="Tone" error={err("tone")}>
            {(aria) => (
              <Select {...aria} value={str(content["tone"]) || "navy"} onChange={(e) => set({ tone: e.target.value })}>
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
              <Input {...aria} value={str(content["heading"])} onChange={(e) => set({ heading: e.target.value })} />
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
                <LabelledInput label="Question" value={str(item["question"])} onChange={(v) => patch({ question: v })} />
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
  }
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
          <Input {...aria} value={str(content["ctaLabel"])} onChange={(e) => set({ ctaLabel: e.target.value })} />
        )}
      </Field>
      <Field id="ctaHref" label="Button link" hint="A path on this site, e.g. /contact" error={err("ctaHref")}>
        {(aria) => (
          <Input {...aria} value={str(content["ctaHref"])} onChange={(e) => set({ ctaHref: e.target.value })} placeholder="/contact" />
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
