"use client";

import * as React from "react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { MediaPicker, type PickedMedia } from "@/components/admin/media-picker";

/**
 * The SEO form fields, shared by every entity that carries the `Seo` relation.
 *
 * Defined once so the page CMS and the catalog screens cannot drift into
 * offering different halves of the same record (CLAUDE.md 4). Every field is
 * optional: blank means "derive", which is what the fallback chains in
 * lib/seo/metadata.ts already do and the right answer for most entities.
 */

export type SeoValues = {
  metaTitle: string | null;
  metaDescription: string | null;
  canonical: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImageId: string | null;
  ogImageAlt: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImageId: string | null;
  robotsIndex: boolean;
  robotsFollow: boolean;
  schemaType: string;
} | null;

const SCHEMA_TYPES = [
  { value: "NONE", label: "None" },
  { value: "FAQ_PAGE", label: "FAQ page" },
  { value: "SERVICE", label: "Service" },
  { value: "ARTICLE", label: "Article" },
  { value: "LOCAL_BUSINESS", label: "Local business" },
  { value: "ORGANIZATION", label: "Organization" },
  { value: "WEBSITE", label: "Website" },
] as const;

/** Character counter that turns amber outside the useful range. */
export function SeoCounter({ value, min, max }: { value: string; min: number; max: number }) {
  const n = value.trim().length;
  const ok = n >= min && n <= max;
  return (
    <span className={ok ? "text-ink-subtle" : "text-warning"}>
      {n} / {max}
    </span>
  );
}

export function SeoFields({
  seo,
  ogImage,
  twitterImage,
  titleHint,
  errors,
}: {
  seo: SeoValues;
  ogImage: PickedMedia | null;
  twitterImage: PickedMedia | null;
  /** What the title falls back to when blank — differs per entity. */
  titleHint: string;
  errors?: Record<string, string[]> | null;
}) {
  const [title, setTitle] = React.useState(seo?.metaTitle ?? "");
  const [description, setDescription] = React.useState(seo?.metaDescription ?? "");
  const err = (name: string) => errors?.[name]?.[0];

  return (
    <div className="space-y-5">
      <Field id="metaTitle" label="Meta title" hint={titleHint} error={err("metaTitle")}>
        {(aria) => (
          <>
            <Input {...aria} name="metaTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
            <p className="mt-1 text-2xs">
              <SeoCounter value={title} min={30} max={60} />
            </p>
          </>
        )}
      </Field>

      <Field id="metaDescription" label="Meta description" error={err("metaDescription")}>
        {(aria) => (
          <>
            <Textarea
              {...aria}
              name="metaDescription"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="mt-1 text-2xs">
              <SeoCounter value={description} min={70} max={160} />
            </p>
          </>
        )}
      </Field>

      <Field
        id="canonical"
        label="Canonical override"
        hint="Blank derives it from the public address, which is normally right."
        error={err("canonical")}
      >
        {(aria) => <Input {...aria} name="canonical" defaultValue={seo?.canonical ?? ""} />}
      </Field>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Open Graph
        </legend>
        <div className="space-y-4">
          <Field id="ogTitle" label="OG title" hint="Blank uses the meta title." error={err("ogTitle")}>
            {(aria) => <Input {...aria} name="ogTitle" defaultValue={seo?.ogTitle ?? ""} />}
          </Field>
          <Field id="ogDescription" label="OG description" error={err("ogDescription")}>
            {(aria) => (
              <Textarea {...aria} name="ogDescription" rows={2} defaultValue={seo?.ogDescription ?? ""} />
            )}
          </Field>
          <MediaPicker name="ogImageId" label="OG image" accept="IMAGE" value={ogImage} />
          <Field
            id="ogImageAlt"
            label="OG image alt"
            hint="Required by the design system whenever an image is set."
            error={err("ogImageAlt")}
          >
            {(aria) => <Input {...aria} name="ogImageAlt" defaultValue={seo?.ogImageAlt ?? ""} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
          Twitter
        </legend>
        <div className="space-y-4">
          <Field id="twitterTitle" label="Twitter title" hint="Blank uses the OG title." error={err("twitterTitle")}>
            {(aria) => <Input {...aria} name="twitterTitle" defaultValue={seo?.twitterTitle ?? ""} />}
          </Field>
          <Field id="twitterDescription" label="Twitter description" error={err("twitterDescription")}>
            {(aria) => (
              <Textarea
                {...aria}
                name="twitterDescription"
                rows={2}
                defaultValue={seo?.twitterDescription ?? ""}
              />
            )}
          </Field>
          <MediaPicker name="twitterImageId" label="Twitter image" accept="IMAGE" value={twitterImage} />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="schemaType" label="Structured data" error={err("schemaType")}>
          {(aria) => (
            <Select {...aria} name="schemaType" defaultValue={seo?.schemaType ?? "NONE"}>
              {SCHEMA_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="space-y-2 self-end pb-1">
          <label className="flex items-center gap-2 text-sm text-navy-800">
            <input
              type="checkbox"
              name="robotsIndex"
              defaultChecked={seo?.robotsIndex ?? true}
              className="size-4 rounded-xs border-line-strong text-brand-red"
            />
            Allow search engines to index this
          </label>
          <label className="flex items-center gap-2 text-sm text-navy-800">
            <input
              type="checkbox"
              name="robotsFollow"
              defaultChecked={seo?.robotsFollow ?? true}
              className="size-4 rounded-xs border-line-strong text-brand-red"
            />
            Follow links from it
          </label>
        </div>
      </div>
    </div>
  );
}
