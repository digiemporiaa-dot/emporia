"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import { slugify } from "@/lib/utils/slug";
import { createPageAction, type PageActionState } from "../../actions";

/**
 * Create a page.
 *
 * The slug is derived from the title as it is typed, and stops following once
 * the slug is edited by hand — a slug that silently rewrites itself after
 * someone has deliberately set it is worse than one that never helped.
 *
 * Client-side slugify is a preview only. The server derives and de-duplicates
 * the real slug, so a page created with JavaScript off still gets a valid one.
 */

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create page"}
    </Button>
  );
}

export function NewPageForm() {
  const router = useRouter();
  const [state, formAction] = useActionState<PageActionState, FormData>(createPageAction, null);
  const [title, setTitle] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);

  React.useEffect(() => {
    if (state?.ok) router.push(`/admin/website/pages/${state.data.id}`);
  }, [state, router]);

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  const preview = slugTouched ? slug : slugify(title);

  return (
    <form action={formAction} className="max-w-2xl space-y-5" noValidate>
      {state && !state.ok ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
        >
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{state.message}</span>
        </div>
      ) : null}

      <Field id="title" label="Page title" required error={err("title")}>
        {(aria) => (
          <Input
            {...aria}
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
        )}
      </Field>

      <Field
        id="slug"
        label="Slug"
        hint="Leave blank to derive it from the title. Must not clash with a built-in route."
        error={err("slug")}
      >
        {(aria) => (
          <Input
            {...aria}
            name="slug"
            value={preview}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="derived-from-title"
          />
        )}
      </Field>

      <p className="text-xs text-ink-subtle">
        Public address: <span className="font-mono text-navy-700">/{preview || "…"}</span>
      </p>

      <div className="flex items-center gap-3">
        <Submit />
        <Link href="/admin/website/pages">
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}
