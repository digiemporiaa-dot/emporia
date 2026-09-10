"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Check, Copy, Link2, TriangleAlert, X } from "lucide-react";
import { Button, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { MediaPicker, type PickedMedia } from "@/components/admin/media-picker";
import type { SeoReport } from "@/lib/seo/analyzer";
import type { LinkSuggestion } from "@/lib/services/seo-links.service";
import type { ActionResult } from "@/lib/errors";
import {
  issuePreviewTokenAction,
  revokePreviewTokenAction,
  savePageSeoAction,
} from "../../actions";

/**
 * The SEO panel.
 *
 * The analyzer's report is computed on the server from the saved page, so what
 * it says is what the page currently *is* — not what the form currently holds.
 * Live-scoring an unsaved draft would be a nicer demo and a worse tool: the
 * number would disagree with the page the moment someone walked away.
 */

type Seo = {
  metaTitle: string | null;
  metaDescription: string | null;
  canonical: string | null;
  targetKeyword: string | null;
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

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save SEO"}
    </Button>
  );
}

/** Character counter that turns amber outside the useful range. */
function Counter({ value, min, max }: { value: string; min: number; max: number }) {
  const n = value.trim().length;
  const ok = n >= min && n <= max;
  return (
    <span className={ok ? "text-ink-subtle" : "text-warning"}>
      {n} / {max}
    </span>
  );
}

export function SeoPanel({
  pageId,
  seo,
  report,
  linkSuggestions,
  ogImage,
  twitterImage,
  previewUrl,
  canEditSeo,
  canEdit,
}: {
  pageId: string;
  seo: Seo;
  report: SeoReport;
  /** Pages this one names but does not link to. Suggestions only — see below. */
  linkSuggestions: readonly LinkSuggestion[];
  ogImage: PickedMedia | null;
  twitterImage: PickedMedia | null;
  previewUrl: string | null;
  canEditSeo: boolean;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    savePageSeoAction,
    null,
  );
  const [title, setTitle] = React.useState(seo?.metaTitle ?? "");
  const [description, setDescription] = React.useState(seo?.metaDescription ?? "");

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  return (
    <section aria-labelledby="seo-heading" className="mt-10 grid gap-8 lg:grid-cols-12">
      <div className="lg:col-span-7">
        <h2 id="seo-heading" className="text-lg text-navy-800">
          Search and social
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Anything left blank is derived — from the page title, its address, and the site defaults.
        </p>

        <form action={formAction} className="mt-5 space-y-5" noValidate>
          <input type="hidden" name="pageId" value={pageId} />

          {state && !state.ok ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
            >
              <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>{state.message}</span>
            </div>
          ) : null}
          {state?.ok ? (
            <div
              role="status"
              className="rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
            >
              Saved.
            </div>
          ) : null}

          <Field
            id="targetKeyword"
            label="Target keyword"
            hint="One phrase this page is written to rank for. Blank switches the keyword checks off."
            error={err("targetKeyword")}
          >
            {(aria) => (
              <Input
                {...aria}
                name="targetKeyword"
                defaultValue={seo?.targetKeyword ?? ""}
                placeholder="digital marketing agency in gurgaon"
              />
            )}
          </Field>

          <Field
            id="metaTitle"
            label="Meta title"
            hint="Blank uses the page title."
            error={err("metaTitle")}
          >
            {(aria) => (
              <>
                <Input
                  {...aria}
                  name="metaTitle"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <p className="mt-1 text-2xs">
                  <Counter value={title} min={30} max={60} />
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
                  <Counter value={description} min={70} max={160} />
                </p>
              </>
            )}
          </Field>

          <Field
            id="canonical"
            label="Canonical override"
            hint="Blank derives it from this page's address, which is normally right."
            error={err("canonical")}
          >
            {(aria) => <Input {...aria} name="canonical" defaultValue={seo?.canonical ?? ""} />}
          </Field>

          <fieldset className="rounded-lg border border-line p-4">
            <legend className="px-1 text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
              Open Graph
            </legend>
            <div className="space-y-4">
              <Field
                id="ogTitle"
                label="OG title"
                hint="Blank uses the meta title."
                error={err("ogTitle")}
              >
                {(aria) => <Input {...aria} name="ogTitle" defaultValue={seo?.ogTitle ?? ""} />}
              </Field>
              <Field id="ogDescription" label="OG description" error={err("ogDescription")}>
                {(aria) => (
                  <Textarea
                    {...aria}
                    name="ogDescription"
                    rows={2}
                    defaultValue={seo?.ogDescription ?? ""}
                  />
                )}
              </Field>
              <MediaPicker name="ogImageId" label="OG image" accept="IMAGE" value={ogImage} />
              <Field
                id="ogImageAlt"
                label="OG image alt"
                hint="Required by the design system whenever an image is set."
                error={err("ogImageAlt")}
              >
                {(aria) => (
                  <Input {...aria} name="ogImageAlt" defaultValue={seo?.ogImageAlt ?? ""} />
                )}
              </Field>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-line p-4">
            <legend className="px-1 text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
              Twitter
            </legend>
            <div className="space-y-4">
              <Field
                id="twitterTitle"
                label="Twitter title"
                hint="Blank uses the OG title."
                error={err("twitterTitle")}
              >
                {(aria) => (
                  <Input {...aria} name="twitterTitle" defaultValue={seo?.twitterTitle ?? ""} />
                )}
              </Field>
              <Field
                id="twitterDescription"
                label="Twitter description"
                error={err("twitterDescription")}
              >
                {(aria) => (
                  <Textarea
                    {...aria}
                    name="twitterDescription"
                    rows={2}
                    defaultValue={seo?.twitterDescription ?? ""}
                  />
                )}
              </Field>
              <MediaPicker
                name="twitterImageId"
                label="Twitter image"
                accept="IMAGE"
                value={twitterImage}
              />
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
                Allow search engines to index this page
              </label>
              <label className="flex items-center gap-2 text-sm text-navy-800">
                <input
                  type="checkbox"
                  name="robotsFollow"
                  defaultChecked={seo?.robotsFollow ?? true}
                  className="size-4 rounded-xs border-line-strong text-brand-red"
                />
                Follow links from this page
              </label>
            </div>
          </div>

          {canEditSeo ? (
            <Submit />
          ) : (
            <p className="text-xs text-ink-subtle">You do not have permission to change SEO.</p>
          )}
        </form>
      </div>

      <div className="lg:col-span-5">
        <ScorePanel report={report} />
        <LinkSuggestions suggestions={linkSuggestions} />
        {canEdit ? <PreviewLinkPanel pageId={pageId} previewUrl={previewUrl} /> : null}
      </div>
    </section>
  );
}

const STATUS_STYLE = {
  pass: { icon: Check, className: "text-success", label: "Passing" },
  warn: { icon: TriangleAlert, className: "text-warning", label: "Worth a look" },
  fail: { icon: X, className: "text-brand-red-text", label: "Needs fixing" },
} as const;

function ScorePanel({ report }: { report: SeoReport }) {
  // The colour is a second signal; the number and the wording carry it alone,
  // so nothing depends on distinguishing red from amber (CLAUDE.md 12).
  const tone =
    report.counts.fail > 0
      ? "text-brand-red-text"
      : report.counts.warn > 0
        ? "text-warning"
        : "text-success";

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-navy-800">SEO check</h3>
        <p className={`font-display text-3xl tabular-nums ${tone}`}>
          {report.score}
          <span className="text-base text-ink-subtle">/100</span>
        </p>
      </div>
      <p className="mt-1 text-xs text-ink-subtle">
        {report.counts.fail} to fix · {report.counts.warn} to review · {report.counts.pass} passing
      </p>
      <p className="mt-1 text-xs text-ink-subtle">
        {report.stats.words} words · {report.stats.internalLinks} internal ·{" "}
        {report.stats.externalLinks} external links · {report.stats.images} images
        {report.stats.keywordDensity === null
          ? ""
          : ` · ${report.stats.keywordDensity.toFixed(1)}% keyword`}
      </p>

      <ul className="mt-4 space-y-2.5">
        {report.checks.map((item) => {
          const style = STATUS_STYLE[item.status];
          const Icon = style.icon;
          return (
            <li key={item.id} className="flex gap-2.5">
              <span className={`mt-0.5 shrink-0 ${style.className}`}>
                <Icon size={14} aria-hidden="true" />
                <span className="sr-only">{style.label}:</span>
              </span>
              <div className="min-w-0">
                <p className="text-sm text-navy-800">{item.label}</p>
                {item.detail ? <p className="text-xs text-ink-muted">{item.detail}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PreviewLinkPanel({ pageId, previewUrl }: { pageId: string; previewUrl: string | null }) {
  const { push } = useToast();
  const [url, setUrl] = React.useState(previewUrl);
  const [pending, startTransition] = React.useTransition();

  const issue = () =>
    startTransition(async () => {
      const result = await issuePreviewTokenAction(pageId);
      if (result.ok) {
        setUrl(`${window.location.origin}/preview/${result.data.token}`);
        push({ tone: "success", title: "Preview link created." });
      } else {
        push({ tone: "error", title: "That did not work.", description: result.message });
      }
    });

  const revoke = () =>
    startTransition(async () => {
      const result = await revokePreviewTokenAction(pageId);
      if (result.ok) {
        setUrl(null);
        push({ tone: "success", title: "Preview link revoked." });
      } else {
        push({ tone: "error", title: "That did not work.", description: result.message });
      }
    });

  return (
    <div className="mt-4 rounded-lg border border-line bg-white p-4">
      <h3 className="text-sm font-semibold text-navy-800">Share a draft</h3>
      <p className="mt-1 text-xs text-ink-muted">
        An unlisted link that shows this page as it stands, to someone without an admin account. It
        is never indexed and never appears in the sitemap.
      </p>

      {url ? (
        <div className="mt-3 space-y-2">
          <p className="break-all rounded-md border border-line bg-surface-muted px-2.5 py-2 font-mono text-2xs text-ink-muted">
            {url}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(url);
                push({ tone: "success", title: "Link copied." });
              }}
            >
              <Copy size={13} aria-hidden="true" />
              Copy
            </Button>
            <Button size="sm" variant="secondary" disabled={pending} onClick={issue}>
              Replace
            </Button>
            <Button size="sm" variant="danger" disabled={pending} onClick={revoke}>
              Revoke
            </Button>
          </div>
          <p className="text-2xs text-ink-subtle">
            Replacing or revoking stops the old link working immediately.
          </p>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="mt-3" disabled={pending} onClick={issue}>
          <Link2 size={13} aria-hidden="true" />
          Create a preview link
        </Button>
      )}
    </div>
  );
}

/**
 * Pages this one mentions by name but does not link to.
 *
 * Suggestions, and only suggestions. There is no "apply": inserting a link into
 * someone's copy means editing a sentence they wrote, and a tool that quietly
 * rewrites what a page claims is not a tool anyone should trust. The editor is
 * told what is missing and where; deciding whether the sentence should carry a
 * link is theirs.
 */
function LinkSuggestions({ suggestions }: { suggestions: readonly LinkSuggestion[] }) {
  if (suggestions.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-line bg-white p-4">
      <h3 className="text-sm font-semibold text-navy-800">Could link to</h3>
      <p className="mt-1 text-xs text-ink-muted">
        This page names these by name without linking to them. Add a link where the sentence
        genuinely calls for one — these are suggestions, and nothing here changes your copy.
      </p>
      <ul className="mt-3 space-y-2">
        {suggestions.map((item) => (
          <li key={item.path} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">
              <span className="text-xs text-navy-800">{item.name}</span>
              <span className="block truncate font-mono text-2xs text-ink-subtle">
                {item.path}
              </span>
            </span>
            <span className="shrink-0 text-2xs text-ink-subtle">{item.kind}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
