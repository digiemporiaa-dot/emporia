"use client";

import * as React from "react";
import { useTransition } from "react";
import { Sparkles } from "lucide-react";
import { AIDraft, AIError } from "@/components/admin/ai-draft";
import { Button, Input, Select } from "@/components/ui";
import { useHydrated } from "@/lib/utils/hydrated";
import { REWRITE_ACTIONS, REWRITE_LABEL, type RewriteAction } from "@/lib/validation/ai-cms";
import { rewriteFieldAction } from "../../actions";

/**
 * Whether the field assists are offered at all.
 *
 * A context rather than a prop because the control lives at the bottom of the
 * block-field tree, and threading a boolean through thirty block editors to
 * reach it would be a change to every one of them. The default is `false`, so
 * a tree that has not deliberately switched drafting on shows no button that
 * could only fail.
 */
const AssistEnabled = React.createContext(false);

export function AssistProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return <AssistEnabled.Provider value={enabled}>{children}</AssistEnabled.Provider>;
}

/**
 * Ask for a different wording of one field.
 *
 * The suggestion appears **beside** the field, never in it. Replacing the text
 * as it arrives would mean the editor's own words are gone before they have
 * read the alternative, and an "undo" is a poor substitute for not having
 * destroyed anything. Applying is one click, and it is theirs.
 *
 * The actions are a closed list rather than a prompt box: an open instruction
 * on a field is a prompt-injection surface and an unbounded cost, for the four
 * things anyone actually asks for.
 */
export function RewriteControl({
  value,
  onApply,
  label,
}: {
  value: string;
  onApply: (text: string) => void;
  label: string;
}) {
  const enabled = React.useContext(AssistEnabled);
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [action, setAction] = React.useState<RewriteAction>("rewrite");
  const [language, setLanguage] = React.useState("");
  const [draft, setDraft] = React.useState<{
    text: string;
    model: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const ask = () => {
    setError(null);
    setDraft(null);
    start(async () => {
      const result = await rewriteFieldAction({
        text: value,
        action,
        ...(action === "translate" ? { language } : {}),
      });
      if (result.ok) setDraft(result.data);
      else setError(result.message);
    });
  };

  const empty = value.trim().length < 2;

  if (!enabled) return null;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          aria-label={`What to do to ${label}`}
          value={action}
          onChange={(event) => setAction(event.target.value as RewriteAction)}
          className="h-7 w-auto text-xs"
        >
          {REWRITE_ACTIONS.map((option) => (
            <option key={option} value={option}>
              {REWRITE_LABEL[option]}
            </option>
          ))}
        </Select>

        {action === "translate" ? (
          <Input
            aria-label="Language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            placeholder="Hindi"
            className="h-7 w-28 text-xs"
          />
        ) : null}

        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || !ready || empty}
          onClick={ask}
        >
          <Sparkles size={12} aria-hidden="true" />
          {pending ? "Thinking…" : "Ask"}
        </Button>

        {empty ? <span className="text-2xs text-ink-subtle">Write something first.</span> : null}
      </div>

      {error ? <AIError message={error} /> : null}

      {draft ? (
        <AIDraft model={draft.model} onDismiss={() => setDraft(null)}>
          <p className="whitespace-pre-wrap text-sm text-ink">{draft.text}</p>
          <div className="mt-2.5">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onApply(draft.text);
                setDraft(null);
              }}
            >
              Use this
            </Button>
          </div>
        </AIDraft>
      ) : null}
    </div>
  );
}
