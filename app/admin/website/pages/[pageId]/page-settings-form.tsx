"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, ExternalLink } from "lucide-react";
import { Button, Field, Input, Textarea, useToast } from "@/components/ui";
import { savePageAction, setPageStatusAction, type PageActionState } from "../../actions";

/**
 * Page settings: title, slug, internal name, description — plus the publish
 * controls.
 *
 * Status deliberately is not a field in this form. Publishing needs
 * `pages.publish` while editing needs only `pages.edit`, so folding it into the
 * save would either over-grant or make an ordinary edit fail for an editor who
 * cannot publish.
 */

type Page = {
  id: string;
  title: string;
  slug: string;
  internalName: string | null;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save settings"}
    </Button>
  );
}

export function PageSettingsForm({ page, canPublish }: { page: Page; canPublish: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const [state, formAction] = useActionState<PageActionState, FormData>(savePageAction, null);
  const [slug, setSlug] = React.useState(page.slug);
  const [pending, startTransition] = React.useTransition();

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  const changeStatus = (status: "DRAFT" | "PUBLISHED" | "ARCHIVED", success: string) => {
    startTransition(async () => {
      const result = await setPageStatusAction(page.id, status);
      if (result.ok) {
        push({ tone: "success", title: success });
        router.refresh();
      } else {
        push({ tone: "error", title: "That did not work.", description: result.message });
      }
    });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <form action={formAction} className="space-y-5" noValidate>
        <input type="hidden" name="id" value={page.id} />
        <input type="hidden" name="status" value={page.status} />

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

        <Field id="title" label="Page title" required error={err("title")}>
          {(aria) => <Input {...aria} name="title" defaultValue={page.title} required />}
        </Field>

        <Field
          id="slug"
          label="Slug"
          required
          hint="Changing this changes the page's public address. Add a redirect from the old one."
          error={err("slug")}
        >
          {(aria) => (
            <Input
              {...aria}
              name="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
            />
          )}
        </Field>

        <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
          Public address: <span className="font-mono text-navy-700">/{slug || "…"}</span>
          {page.status === "PUBLISHED" && slug === page.slug ? (
            <a
              href={`/${page.slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-brand-red-text hover:underline"
            >
              Open <ExternalLink size={11} aria-hidden="true" />
            </a>
          ) : null}
        </p>

        <Field
          id="internalName"
          label="Internal name"
          hint="Only shown in the admin. Useful when 200 pages all start with the same word."
          error={err("internalName")}
        >
          {(aria) => (
            <Input {...aria} name="internalName" defaultValue={page.internalName ?? ""} />
          )}
        </Field>

        <Field id="description" label="Internal note" error={err("description")}>
          {(aria) => (
            <Textarea {...aria} name="description" rows={3} defaultValue={page.description ?? ""} />
          )}
        </Field>

        <Submit />
      </form>

      <div className="rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-navy-800">Publishing</h2>
        <p className="mt-1 text-xs text-ink-muted">
          {page.status === "PUBLISHED"
            ? "This page is live and can appear in the sitemap."
            : "This page is not public. Only the admin can see it."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {page.status !== "PUBLISHED" ? (
            <Button
              size="sm"
              disabled={!canPublish || pending}
              onClick={() => changeStatus("PUBLISHED", "Page published.")}
            >
              Publish
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => changeStatus("DRAFT", "Page moved back to draft.")}
            >
              Unpublish
            </Button>
          )}
          {page.status !== "ARCHIVED" ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => changeStatus("ARCHIVED", "Page archived.")}
            >
              Archive
            </Button>
          ) : null}
        </div>
        {!canPublish && page.status !== "PUBLISHED" ? (
          <p className="mt-2 text-xs text-ink-subtle">
            You can edit this page but not publish it.
          </p>
        ) : null}
      </div>
    </div>
  );
}
