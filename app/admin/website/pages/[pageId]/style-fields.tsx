"use client";

import * as React from "react";
import { Field, Input, Select } from "@/components/ui";
import { MediaPicker, type PickedMedia } from "@/components/admin/media-picker";
import {
  CONTAINER_LABELS,
  POSITION_LABELS,
  SPACE_LABELS,
  type BackgroundPosition,
  type ContainerToken,
  type SpaceToken,
} from "@/lib/content/presentation";
import { GAP_LABELS, type GapToken } from "@/lib/content/grid";

/**
 * The Layout, Grid and Style tabs.
 *
 * These edit two objects shared by every block — `band` (presentation) and
 * `grid` — so a control added here appears on every block that supports it,
 * rather than fourteen editors each growing their own copy.
 *
 * Nothing here validates. The shapes are checked by zod in the service, which
 * is the only copy of the rules that counts (CLAUDE.md 2 rule 4); these forms
 * shape the input and give the editor a picker instead of a text box.
 */

export type Content = Record<string, unknown>;

const obj = (value: unknown): Content =>
  value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Content) } : {};

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const SPACE_TOKENS: SpaceToken[] = ["none", "xs", "sm", "md", "lg", "xl", "2xl"];
const CONTAINER_TOKENS: ContainerToken[] = ["narrow", "medium", "default", "wide", "full"];
const GAP_TOKENS: GapToken[] = ["xs", "sm", "md", "lg", "xl"];
const POSITIONS: BackgroundPosition[] = [
  "center",
  "top",
  "bottom",
  "left",
  "right",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

function Tokens({
  id,
  label,
  hint,
  value,
  fallback,
  options,
  labels,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  fallback: string;
  options: readonly string[];
  labels: Record<string, string>;
  onChange: (next: string) => void;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      {(aria) => (
        <Select {...aria} value={value || fallback} onChange={(e) => onChange(e.target.value)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {labels[option]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/**
 * A colour control.
 *
 * A native colour input plus the hex beside it: the swatch is how someone
 * picks a colour, the text is how they paste the one from the brand guide.
 * Both write the same value, and the schema rejects anything that is not a
 * six-digit hex.
 */
function ColorField({
  id,
  label,
  value,
  fallback,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  fallback: string;
  onChange: (next: string) => void;
}) {
  const current = /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  return (
    <Field id={id} label={label} hint="Six-digit hex, e.g. #002A3A.">
      {(aria) => (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={`${label} swatch`}
            value={current}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="h-9.5 w-12 shrink-0 cursor-pointer rounded-md border border-line-strong bg-white p-1"
          />
          <Input
            {...aria}
            value={value}
            placeholder={fallback}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono"
          />
        </div>
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function LayoutFields({
  content,
  set,
}: {
  content: Content;
  set: (patch: Content) => void;
}) {
  const band = obj(content["band"]);
  const patch = (next: Content) => set({ band: { ...band, ...next } });

  return (
    <div className="space-y-5">
      <Tokens
        id="band-container"
        label="Section width"
        hint="Full width opts out of the page container entirely."
        value={str(band["container"])}
        fallback="default"
        options={CONTAINER_TOKENS}
        labels={CONTAINER_LABELS}
        onChange={(container) => patch({ container })}
      />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
          Spacing inside the section
        </legend>
        <Tokens
          id="band-pt"
          label="Padding top"
          value={str(band["paddingTop"])}
          fallback=""
          options={["", ...SPACE_TOKENS]}
          labels={{ "": "Block default", ...SPACE_LABELS }}
          onChange={(paddingTop) => patch({ paddingTop: paddingTop || undefined })}
        />
        <Tokens
          id="band-pb"
          label="Padding bottom"
          value={str(band["paddingBottom"])}
          fallback=""
          options={["", ...SPACE_TOKENS]}
          labels={{ "": "Block default", ...SPACE_LABELS }}
          onChange={(paddingBottom) => patch({ paddingBottom: paddingBottom || undefined })}
        />
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
          Spacing around the section
        </legend>
        <Tokens
          id="band-mt"
          label="Margin top"
          value={str(band["marginTop"])}
          fallback="none"
          options={SPACE_TOKENS}
          labels={SPACE_LABELS}
          onChange={(marginTop) => patch({ marginTop })}
        />
        <Tokens
          id="band-mb"
          label="Margin bottom"
          value={str(band["marginBottom"])}
          fallback="none"
          options={SPACE_TOKENS}
          labels={SPACE_LABELS}
          onChange={(marginBottom) => patch({ marginBottom })}
        />
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Tokens
          id="band-align"
          label="Text alignment"
          value={str(band["align"])}
          fallback=""
          options={["", "left", "center", "right"]}
          labels={{ "": "Block default", left: "Left", center: "Centre", right: "Right" }}
          onChange={(align) => patch({ align: align || undefined })}
        />
        <Tokens
          id="band-valign"
          label="Vertical alignment"
          hint="Applies where the section has columns to line up."
          value={str(band["verticalAlign"])}
          fallback=""
          options={["", "top", "center", "bottom"]}
          labels={{ "": "Block default", top: "Top", center: "Centre", bottom: "Bottom" }}
          onChange={(verticalAlign) => patch({ verticalAlign: verticalAlign || undefined })}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

const COUNTS = (max: number) => Array.from({ length: max }, (_, index) => String(index + 1));
const COUNT_LABELS = Object.fromEntries(
  COUNTS(6).map((n) => [n, `${n} column${n === "1" ? "" : "s"}`]),
);

export function GridFields({
  content,
  set,
  /** The legacy per-block column count, used as the starting desktop value. */
  legacyColumns,
}: {
  content: Content;
  set: (patch: Content) => void;
  legacyColumns?: number;
}) {
  const grid = obj(content["grid"]);
  const desktop = Number(grid["desktop"] ?? legacyColumns ?? 3);
  const tablet = Number(grid["tablet"] ?? 2);
  const mobile = Number(grid["mobile"] ?? 1);
  const gap = str(grid["gap"]) || "md";

  const patch = (next: Content) =>
    set({ grid: { desktop, tablet, mobile, gap, ...obj(content["grid"]), ...next } });

  return (
    <div className="space-y-5">
      <p className="text-xs text-ink-subtle">
        The public page uses CSS Grid at these breakpoints. Nothing is measured in JavaScript, so
        the layout is right in the first paint rather than after it.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tokens
          id="grid-desktop"
          label="Desktop"
          value={String(desktop)}
          fallback="3"
          options={COUNTS(6)}
          labels={COUNT_LABELS}
          onChange={(value) => patch({ desktop: Number(value) })}
        />
        <Tokens
          id="grid-tablet"
          label="Tablet"
          value={String(tablet)}
          fallback="2"
          options={COUNTS(4)}
          labels={COUNT_LABELS}
          onChange={(value) => patch({ tablet: Number(value) })}
        />
        <Tokens
          id="grid-mobile"
          label="Mobile"
          value={String(mobile)}
          fallback="1"
          options={COUNTS(2)}
          labels={COUNT_LABELS}
          onChange={(value) => patch({ mobile: Number(value) })}
        />
      </div>

      <GridPreview desktop={desktop} tablet={tablet} mobile={mobile} gap={gap as GapToken} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Tokens
          id="grid-gap"
          label="Gap"
          value={gap}
          fallback="md"
          options={GAP_TOKENS}
          labels={GAP_LABELS}
          onChange={(value) => patch({ gap: value })}
        />
        <Tokens
          id="grid-rowgap"
          label="Row gap"
          value={str(grid["rowGap"])}
          fallback=""
          options={["", ...GAP_TOKENS]}
          labels={{ "": "Same as gap", ...GAP_LABELS }}
          onChange={(value) => patch({ rowGap: value || undefined })}
        />
        <Tokens
          id="grid-colgap"
          label="Column gap"
          value={str(grid["columnGap"])}
          fallback=""
          options={["", ...GAP_TOKENS]}
          labels={{ "": "Same as gap", ...GAP_LABELS }}
          onChange={(value) => patch({ columnGap: value || undefined })}
        />
      </div>
    </div>
  );
}

const PREVIEW_GAP: Record<GapToken, string> = {
  xs: "gap-0.5",
  sm: "gap-1",
  md: "gap-1.5",
  lg: "gap-2.5",
  xl: "gap-3.5",
};

/**
 * A schematic of the three breakpoints, updating as the controls change.
 *
 * Deliberately a diagram and not a rendering of the section: pretending to be
 * the page while being a different component is how a preview starts lying.
 * The full page is one click away through Save and preview, which renders
 * through the same code the public site uses.
 */
function GridPreview({
  desktop,
  tablet,
  mobile,
  gap,
}: {
  desktop: number;
  tablet: number;
  mobile: number;
  gap: GapToken;
}) {
  const frames: [string, number][] = [
    ["Desktop", desktop],
    ["Tablet", tablet],
    ["Mobile", mobile],
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3" aria-hidden="true">
      {frames.map(([label, columns]) => (
        <div key={label} className="rounded-md border border-line bg-surface-muted/60 p-2.5">
          <p className="mb-2 text-2xs uppercase tracking-wide text-ink-subtle">
            {label} · {columns}
          </p>
          <div className={`flex ${PREVIEW_GAP[gap]}`}>
            {Array.from({ length: columns }).map((_, index) => (
              <span key={index} className="h-8 flex-1 rounded-xs bg-navy-200" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

export function StyleFields({
  content,
  set,
  backgroundMedia,
}: {
  content: Content;
  set: (patch: Content) => void;
  backgroundMedia: PickedMedia | null;
}) {
  const band = obj(content["band"]);
  const background = obj(band["background"]);
  const kind = str(background["kind"]) || "none";

  const patchBand = (next: Content) => set({ band: { ...band, ...next } });
  const patchBackground = (next: Content) =>
    patchBand({ background: { ...background, ...next } });

  return (
    <div className="space-y-5">
      <Tokens
        id="bg-kind"
        label="Background"
        value={kind}
        fallback="none"
        options={["none", "solid", "gradient", "image"]}
        labels={{ none: "None", solid: "Solid colour", gradient: "Gradient", image: "Image" }}
        onChange={(value) => patchBackground({ kind: value })}
      />

      {kind === "solid" || kind === "gradient" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <ColorField
            id="bg-color"
            label={kind === "gradient" ? "Gradient from" : "Colour"}
            value={str(background["color"])}
            fallback="#002A3A"
            onChange={(color) => patchBackground({ color })}
          />
          {kind === "gradient" ? (
            <ColorField
              id="bg-color-to"
              label="Gradient to"
              value={str(background["colorTo"])}
              fallback="#DF1F38"
              onChange={(colorTo) => patchBackground({ colorTo })}
            />
          ) : null}
        </div>
      ) : null}

      {kind === "gradient" ? (
        <Field id="bg-angle" label="Gradient angle" hint="Degrees, 0–360.">
          {(aria) => (
            <Input
              {...aria}
              type="number"
              min={0}
              max={360}
              value={String(background["angle"] ?? 160)}
              onChange={(e) => patchBackground({ angle: Number(e.target.value) })}
            />
          )}
        </Field>
      ) : null}

      {kind === "image" ? (
        <div className="space-y-4">
          <MediaPicker
            name="band-background"
            label="Background image"
            accept="IMAGE"
            value={backgroundMedia}
            onChange={(picked) => patchBackground({ mediaId: picked?.id ?? "" })}
            hint="From the media library. A background is decorative, so it carries no alt text."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Tokens
              id="bg-size"
              label="Fit"
              value={str(background["size"]) || "cover"}
              fallback="cover"
              options={["cover", "contain"]}
              labels={{ cover: "Cover", contain: "Contain" }}
              onChange={(size) => patchBackground({ size })}
            />
            <Tokens
              id="bg-position"
              label="Position"
              value={str(background["position"]) || "center"}
              fallback="center"
              options={POSITIONS}
              labels={POSITION_LABELS}
              onChange={(position) => patchBackground({ position })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-navy-800">
            <input
              type="checkbox"
              checked={background["overlay"] === true}
              onChange={(e) => patchBackground({ overlay: e.target.checked })}
              className="size-4 accent-[var(--color-brand-red)]"
            />
            Tint the image, so text stays readable over it
          </label>

          {background["overlay"] === true ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField
                id="bg-overlay-color"
                label="Overlay colour"
                value={str(background["overlayColor"])}
                fallback="#002A3A"
                onChange={(overlayColor) => patchBackground({ overlayColor })}
              />
              <Field id="bg-overlay-opacity" label="Overlay opacity" hint="Percent.">
                {(aria) => (
                  <Input
                    {...aria}
                    type="number"
                    min={0}
                    max={100}
                    value={String(background["overlayOpacity"] ?? 40)}
                    onChange={(e) => patchBackground({ overlayOpacity: Number(e.target.value) })}
                  />
                )}
              </Field>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Tokens
          id="band-border"
          label="Border"
          value={str(band["border"]) || "none"}
          fallback="none"
          options={["none", "subtle", "strong"]}
          labels={{ none: "None", subtle: "Subtle", strong: "Strong" }}
          onChange={(border) => patchBand({ border })}
        />
        <Tokens
          id="band-radius"
          label="Corner radius"
          value={str(band["radius"]) || "none"}
          fallback="none"
          options={["none", "sm", "md", "lg", "xl", "full"]}
          labels={{
            none: "None",
            sm: "Small",
            md: "Medium",
            lg: "Large",
            xl: "Extra large",
            full: "Fully rounded",
          }}
          onChange={(radius) => patchBand({ radius })}
        />
        <Tokens
          id="band-tone"
          label="Text colour"
          hint="Set Light over a dark background."
          value={str(band["textTone"]) || "auto"}
          fallback="auto"
          options={["auto", "dark", "light"]}
          labels={{ auto: "Automatic", dark: "Dark", light: "Light" }}
          onChange={(textTone) => patchBand({ textTone })}
        />
      </div>
    </div>
  );
}
