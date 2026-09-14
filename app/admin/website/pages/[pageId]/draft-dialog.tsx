"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { AIDraft, AIError } from "@/components/admin/ai-draft";
import { Button, Dialog, Textarea } from "@/components/ui";
import { BLOCK_LIBRARY, blockDefinition, isBlockType } from "@/lib/content/blocks";
import { templatePermits } from "@/lib/content/templates";
import { sectionText } from "@/lib/content/text";
import { useHydrated } from "@/lib/utils/hydrated";
import { generateBlocksAction } from "../../actions";

/**
 * Draft a run of bands from a brief.
 *
 * Two steps, deliberately: drafting produces something to read, and a separate
 * click puts it on the page. Nothing is written until that second click, and
 * what it writes goes through `addSections`, which parses every band against
 * its own schema exactly as a hand-built one is parsed.
 *
 * The editor chooses the bands; the model fills them. Letting it choose its own
 * structure produced drafts that ignored the template and had to be discarded,
 * and a shape the editor already agreed to is a draft they can actually use.
 */

const MAX_BANDS = 8;

type Drafted = { type: string; content: unknown };

export function DraftSectionsDialog({
  pageId,
  allowedBlocks,
  onClose,
  onAdded,
}: {
  pageId: string;
  allowedBlocks: readonly string[];
  onClose: () => void;
  onAdded: (blocks: Drafted[]) => void;
}) {
  const ready = useHydrated();
  const [pending, start] = React.useTransition();
  const [brief, setBrief] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState<{
    blocks: Drafted[];
    rejected: string[];
    model: string;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const choices = BLOCK_LIBRARY.filter((block) => templatePermits(allowedBlocks, block.type));

  const toggle = (type: string) =>
    setPicked((current) =>
      current.includes(type)
        ? current.filter((entry) => entry !== type)
        : current.length >= MAX_BANDS
          ? current
          : [...current, type],
    );

  const ask = () => {
    setError(null);
    setDraft(null);
    start(async () => {
      const result = await generateBlocksAction({
        pageId,
        brief,
        blocks: picked,
      });
      if (result.ok) setDraft(result.data);
      else setError(result.message);
    });
  };

  const tooShort = brief.trim().length < 10;
  const canAsk = ready && !pending && !tooShort && picked.length > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Draft sections"
      description="Say what the page is about and choose the bands. Nothing is added until you say so."
    >
      <div className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
            What is this page about?
          </span>
          <Textarea
            rows={3}
            value={brief}
            maxLength={1000}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="A page for our SEO retainer aimed at D2C brands in Gurgaon — what it covers, who it suits, and what it costs."
          />
        </label>

        <div>
          <p className="mb-2 text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
            Bands, in order ({picked.length}/{MAX_BANDS})
          </p>
          {/* Scrolled rather than laid out in full: there are nearly forty
              bands, and a dialog tall enough to show them all pushes the brief
              off the top and the draft off the bottom. */}
          <ul className="grid max-h-56 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
            {choices.map((block) => {
              const at = picked.indexOf(block.type);
              return (
                <li key={block.type}>
                  <button
                    type="button"
                    aria-pressed={at >= 0}
                    disabled={at < 0 && picked.length >= MAX_BANDS}
                    onClick={() => toggle(block.type)}
                    className={
                      at >= 0
                        ? "flex w-full items-center gap-2 rounded-md border border-brand-red bg-red-50/60 px-3 py-2 text-left"
                        : "flex w-full items-center gap-2 rounded-md border border-line px-3 py-2 text-left hover:border-brand-red hover:bg-red-50/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-transparent"
                    }
                  >
                    <span
                      aria-hidden="true"
                      className={
                        at >= 0
                          ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-red text-2xs font-semibold text-white"
                          : "h-5 w-5 shrink-0 rounded-full border border-line"
                      }
                    >
                      {at >= 0 ? at + 1 : ""}
                    </span>
                    <span className="text-sm text-navy-800">{block.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" disabled={!canAsk} onClick={ask}>
            <Sparkles size={13} aria-hidden="true" />
            {pending ? "Drafting…" : "Draft these bands"}
          </Button>
          {tooShort ? (
            <span className="text-2xs text-ink-subtle">Say a little more about the page.</span>
          ) : picked.length === 0 ? (
            <span className="text-2xs text-ink-subtle">Choose at least one band.</span>
          ) : null}
        </div>

        {error ? <AIError message={error} /> : null}

        {draft ? (
          <AIDraft model={draft.model} onDismiss={() => setDraft(null)}>
            {draft.blocks.length === 0 ? (
              <p className="text-sm text-ink">
                Nothing usable came back. Try again, or add the bands by hand.
              </p>
            ) : (
              <ol className="space-y-2.5">
                {draft.blocks.map((block, index) => {
                  const words = sectionText(block.type, block.content).text;
                  return (
                    <li key={`${block.type}-${index}`}>
                      <p className="text-2xs uppercase tracking-wide text-ink-subtle">
                        {isBlockType(block.type) ? blockDefinition(block.type).label : block.type}
                      </p>
                      <p className="line-clamp-3 text-sm text-ink">
                        {words || "No copy — the band came back empty."}
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}

            {draft.rejected.length > 0 ? (
              // Named rather than silently dropped: an editor who asked for six
              // bands and got four should know which two, and why.
              <p className="mt-2.5 text-2xs text-ink-subtle">
                {draft.rejected.length} band
                {draft.rejected.length === 1 ? "" : "s"} came back in a shape this page cannot use
                and {draft.rejected.length === 1 ? "was" : "were"} dropped:{" "}
                {draft.rejected.join(", ")}.
              </p>
            ) : null}

            {draft.blocks.length > 0 ? (
              <div className="mt-2.5">
                <Button type="button" size="sm" onClick={() => onAdded(draft.blocks)}>
                  Add {draft.blocks.length} band
                  {draft.blocks.length === 1 ? "" : "s"} to the page
                </Button>
              </div>
            ) : null}
          </AIDraft>
        ) : null}
      </div>
    </Dialog>
  );
}
