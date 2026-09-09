"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui";
import { SeoFields, type SeoValues } from "@/components/admin/seo-fields";
import type { PickedMedia } from "@/components/admin/media-picker";
import type { ActionResult } from "@/lib/errors";
import { saveEntitySeoAction } from "@/app/admin/catalog/actions";

/**
 * SEO panel for a catalog entity.
 *
 * A separate form from the entity's own, because the two are gated on different
 * permissions: editing a package needs `catalog.edit`, editing its metadata
 * needs `seo.edit`. Folding them together would either over-grant or make an
 * ordinary edit fail for someone who may not touch SEO.
 */

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save SEO"}
    </Button>
  );
}

export function EntitySeoPanel({
  entity,
  id,
  seo,
  ogImage,
  twitterImage,
  titleHint,
  canEdit,
}: {
  entity: "city" | "serviceCityPage" | "servicePackage" | "service" | "blogPost" | "caseStudy";
  id: string;
  seo: SeoValues;
  ogImage: PickedMedia | null;
  twitterImage: PickedMedia | null;
  titleHint: string;
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    saveEntitySeoAction,
    null,
  );

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;

  return (
    <section aria-labelledby="entity-seo-heading" className="mt-10 max-w-2xl">
      <h2 id="entity-seo-heading" className="text-lg text-navy-800">
        Search and social
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Anything left blank is derived — from this record and the site defaults.
      </p>

      <form action={formAction} className="mt-5 space-y-5" noValidate>
        <input type="hidden" name="entity" value={entity} />
        <input type="hidden" name="id" value={id} />

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

        <SeoFields
          seo={seo}
          ogImage={ogImage}
          twitterImage={twitterImage}
          titleHint={titleHint}
          errors={fieldErrors}
        />

        {canEdit ? (
          <Submit />
        ) : (
          <p className="text-xs text-ink-subtle">You do not have permission to change SEO.</p>
        )}
      </form>
    </section>
  );
}
