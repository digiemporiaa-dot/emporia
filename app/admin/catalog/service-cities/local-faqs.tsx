"use client";

import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { addLocalFaqAction, deleteLocalFaqAction } from "../actions";
import type { ActionResult } from "@/lib/errors";

type Faq = { id: string; question: string; answer: string; order: number; isActive: boolean };

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Adding…" : "Add FAQ"}
    </Button>
  );
}

function DeleteButton({ id, pageId }: { id: string; pageId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await deleteLocalFaqAction(id, pageId)))}
      className="rounded-sm p-1 text-ink-subtle transition-colors hover:bg-red-50 hover:text-brand-red disabled:opacity-60"
    >
      <Trash2 size={14} aria-hidden="true" />
      <span className="sr-only">Delete FAQ</span>
    </button>
  );
}

/** Local FAQs. Three active ones are required before a page can publish. */
export function LocalFaqs({
  pageId,
  faqs,
  canEdit,
}: {
  pageId: string;
  faqs: readonly Faq[];
  canEdit: boolean;
}) {
  const [state, formAction] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    addLocalFaqAction,
    null,
  );

  const active = faqs.filter((f) => f.isActive).length;

  return (
    <section className="rounded-lg border border-line bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-navy-800">Local FAQs</h2>
        <span className="text-xs tabular-nums text-ink-subtle">{active} of 3 required</span>
      </div>

      {faqs.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-ink-subtle">
          No local questions yet. Three are needed before this page can publish.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {faqs.map((faq) => (
            <li key={faq.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-navy-800">{faq.question}</p>
                <p className="mt-1 text-xs text-ink-muted">{faq.answer}</p>
              </div>
              {canEdit ? <DeleteButton id={faq.id} pageId={pageId} /> : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form action={formAction} className="space-y-3 border-t border-line px-4 py-4" noValidate>
          <input type="hidden" name="serviceCityPageId" value={pageId} />
          {state && !state.ok ? (
            <p role="alert" className="text-xs text-brand-red-text">
              {state.message}
            </p>
          ) : null}
          <Field id="question" label="Question">
            {(aria) => <Input {...aria} name="question" required />}
          </Field>
          <Field id="answer" label="Answer">
            {(aria) => <Textarea {...aria} name="answer" rows={3} required />}
          </Field>
          <Submit />
        </form>
      ) : null}
    </section>
  );
}
