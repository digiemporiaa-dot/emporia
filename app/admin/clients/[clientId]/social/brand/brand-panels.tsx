"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Archive, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import type { SocialProvider } from "@/generated/prisma/enums";
import {
  archivePillarAction,
  movePillarAction,
  saveBrandProfileAction,
  savePillarAction,
  saveStrategyAction,
} from "./actions";

/**
 * The brand kit's three panels. Each saves on its own: a tone and a KPI
 * target are edited at different times by different people, and one form
 * would make a typo in one block the reason the other does not save.
 */

/** "a, b\nc" → ["a", "b", "c"]. What a person types into a list field. */
function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function useSave() {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = React.useTransition();
  const run = (work: () => Promise<ActionResult<unknown>>, success: string) =>
    start(async () => {
      const result = await work();
      if (!result.ok) {
        push({ tone: "error", title: "That did not save.", description: result.message });
        return;
      }
      push({ tone: "success", title: success });
      router.refresh();
    });
  return { pending, run };
}

// ---------------------------------------------------------------------------
// Brand profile
// ---------------------------------------------------------------------------

export type BrandProfileView = {
  brandName: string | null;
  tone: string | null;
  industry: string | null;
  targetAudience: string | null;
  preferredLanguage: string | null;
  ctaStyle: string | null;
  brandColors: string[];
  hashtags: string[];
  forbiddenWords: string[];
  preferredEmojis: string[];
  postingRules: string | null;
};

export function BrandProfilePanel({
  clientId,
  profile,
  canEdit,
}: {
  clientId: string;
  profile: BrandProfileView | null;
  canEdit: boolean;
}) {
  const { pending, run } = useSave();
  const [form, setForm] = React.useState({
    brandName: profile?.brandName ?? "",
    tone: profile?.tone ?? "",
    industry: profile?.industry ?? "",
    targetAudience: profile?.targetAudience ?? "",
    preferredLanguage: profile?.preferredLanguage ?? "",
    ctaStyle: profile?.ctaStyle ?? "",
    brandColors: (profile?.brandColors ?? []).join(", "),
    hashtags: (profile?.hashtags ?? []).map((t) => `#${t}`).join(" "),
    forbiddenWords: (profile?.forbiddenWords ?? []).join(", "),
    preferredEmojis: (profile?.preferredEmojis ?? []).join(" "),
    postingRules: profile?.postingRules ?? "",
  });
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const colours = splitList(form.brandColors).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));

  const save = () =>
    run(
      () =>
        saveBrandProfileAction({
          clientId,
          profile: {
            ...form,
            brandColors: splitList(form.brandColors),
            hashtags: form.hashtags.split(/[\s,]+/).filter(Boolean),
            forbiddenWords: splitList(form.forbiddenWords),
            preferredEmojis: form.preferredEmojis.split(/\s+/).filter(Boolean),
          },
        }),
      "Brand profile saved.",
    );

  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>Brand profile</CardTitle>
          <p className="text-xs text-ink-subtle">
          How this client sounds. Every AI caption draft is written against it, and forbidden words are
          flagged on the draft.
        </p>
        </div>
      </CardHeader>
      <CardBody>
        <fieldset disabled={!canEdit || pending} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="brandName" label="Brand name" hint="Where it differs from the client's legal name.">
              {(aria) => <Input {...aria} value={form.brandName} onChange={set("brandName")} />}
            </Field>
            <Field id="industry" label="Industry">
              {(aria) => <Input {...aria} value={form.industry} onChange={set("industry")} />}
            </Field>
          </div>
          <Field id="tone" label="Tone" hint="e.g. Warm, plain-spoken, confident without boasting.">
            {(aria) => <Textarea {...aria} rows={2} value={form.tone} onChange={set("tone")} />}
          </Field>
          <Field id="targetAudience" label="Target audience">
            {(aria) => <Textarea {...aria} rows={2} value={form.targetAudience} onChange={set("targetAudience")} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="preferredLanguage" label="Preferred language" hint="e.g. English, Hinglish, Hindi.">
              {(aria) => <Input {...aria} value={form.preferredLanguage} onChange={set("preferredLanguage")} />}
            </Field>
            <Field id="ctaStyle" label="Call-to-action style" hint="e.g. Soft — invite, never push.">
              {(aria) => <Input {...aria} value={form.ctaStyle} onChange={set("ctaStyle")} />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="hashtags" label="Brand hashtags" hint="Added to AI drafts where the platform uses hashtags.">
              {(aria) => <Input {...aria} value={form.hashtags} onChange={set("hashtags")} placeholder="#northwind" />}
            </Field>
            <Field id="preferredEmojis" label="Emojis the brand uses" hint="Separated by spaces.">
              {(aria) => <Input {...aria} value={form.preferredEmojis} onChange={set("preferredEmojis")} />}
            </Field>
          </div>
          <Field
            id="forbiddenWords"
            label="Forbidden words"
            hint="Comma-separated. The AI is told never to use them, and drafts that do are flagged."
          >
            {(aria) => <Textarea {...aria} rows={2} value={form.forbiddenWords} onChange={set("forbiddenWords")} />}
          </Field>
          <Field id="brandColors" label="Brand colours" hint="Hex values, comma-separated. For the designer.">
            {(aria) => (
              <div className="flex flex-wrap items-center gap-2">
                <Input {...aria} className="min-w-0 flex-1" value={form.brandColors} onChange={set("brandColors")} placeholder="#DF1F38, #002A3A" />
                <span className="flex gap-1" aria-hidden="true">
                  {colours.map((colour) => (
                    <span key={colour} className="size-6 rounded border border-line" style={{ backgroundColor: colour }} />
                  ))}
                </span>
              </div>
            )}
          </Field>
          <Field id="postingRules" label="Posting rules" hint="Anything the team must always or never do.">
            {(aria) => <Textarea {...aria} rows={3} value={form.postingRules} onChange={set("postingRules")} />}
          </Field>
          {canEdit ? (
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save brand profile"}
            </Button>
          ) : null}
        </fieldset>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Content pillars
// ---------------------------------------------------------------------------

export type PillarView = {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  items: number;
};

export function PillarsPanel({
  clientId,
  pillars,
  canEdit,
}: {
  clientId: string;
  pillars: readonly PillarView[];
  canEdit: boolean;
}) {
  const { pending, run } = useSave();
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");

  const active = pillars.filter((p) => !p.archived);
  const archived = pillars.filter((p) => p.archived);

  const open = (pillar: PillarView | null) => {
    setEditing(pillar ? pillar.id : "new");
    setName(pillar?.name ?? "");
    setDescription(pillar?.description ?? "");
  };

  const save = () =>
    run(async () => {
      const result = await savePillarAction({
        clientId,
        id: editing === "new" ? null : editing,
        pillar: { name, description },
      });
      if (result.ok) setEditing(null);
      return result;
    }, editing === "new" ? "Pillar added." : "Pillar saved.");

  const form = (
    <div className="space-y-3 rounded-md border border-line bg-surface-muted p-3">
      <Field id="pillar-name" label="Pillar name" required>
        {(aria) => <Input {...aria} value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer stories" />}
      </Field>
      <Field id="pillar-description" label="What belongs here">
        {(aria) => <Textarea {...aria} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending || !name.trim()}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>Content pillars</CardTitle>
          <p className="text-xs text-ink-subtle">
          The recurring themes this client&apos;s content is built around. Ideas are filed under one; the
          calendar and content list filter by it.
        </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {active.length === 0 && editing !== "new" ? (
          <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-subtle">
            No pillars yet.
          </p>
        ) : null}

        <ol className="divide-y divide-line">
          {active.map((pillar, index) => (
            <li key={pillar.id} className="py-3 first:pt-0">
              {editing === pillar.id ? (
                form
              ) : (
                <div className="flex flex-wrap items-start gap-3">
                  <span className="mt-0.5 w-5 text-right text-xs tabular-nums text-ink-subtle">{index + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy-800">{pillar.name}</p>
                    {pillar.description ? <p className="text-xs text-ink-subtle">{pillar.description}</p> : null}
                    <p className="mt-0.5 text-2xs text-ink-subtle">
                      {pillar.items} idea{pillar.items === 1 ? "" : "s"}
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${pillar.name} up`}
                        disabled={pending || index === 0}
                        onClick={() => run(() => movePillarAction({ clientId, id: pillar.id, direction: "up" }), "Moved.")}
                      >
                        <ArrowUp size={14} aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${pillar.name} down`}
                        disabled={pending || index === active.length - 1}
                        onClick={() => run(() => movePillarAction({ clientId, id: pillar.id, direction: "down" }), "Moved.")}
                      >
                        <ArrowDown size={14} aria-hidden="true" />
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => open(pillar)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Archive ${pillar.name}`}
                        disabled={pending}
                        onClick={() =>
                          run(() => archivePillarAction({ clientId, id: pillar.id, archived: true }), "Pillar archived.")
                        }
                      >
                        <Archive size={14} aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ol>

        {editing === "new" ? form : null}
        {canEdit && editing === null ? (
          <Button size="sm" variant="secondary" onClick={() => open(null)}>
            <Plus size={14} aria-hidden="true" />
            Add pillar
          </Button>
        ) : null}

        {archived.length > 0 ? (
          <details className="rounded-md border border-line px-3 py-2">
            <summary className="cursor-pointer text-xs text-ink-subtle">{archived.length} archived</summary>
            <ul className="mt-2 space-y-1.5">
              {archived.map((pillar) => (
                <li key={pillar.id} className="flex items-center gap-2 text-sm text-ink-muted">
                  <span className="flex-1">
                    {pillar.name}{" "}
                    <span className="text-2xs text-ink-subtle">
                      · {pillar.items} idea{pillar.items === 1 ? "" : "s"} keep it
                    </span>
                  </span>
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        run(() => archivePillarAction({ clientId, id: pillar.id, archived: false }), "Pillar restored.")
                      }
                    >
                      <RotateCcw size={13} aria-hidden="true" />
                      Restore
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

export type StrategyFormView = {
  objectives: string | null;
  platforms: SocialProvider[];
  postingFrequency: Partial<Record<SocialProvider, number>>;
  campaignGoals: string | null;
  kpiTargets: { metric: string; target: number; period: string }[];
};

export function StrategyPanel({
  clientId,
  strategy,
  providers,
  metrics,
  periods,
  canEdit,
}: {
  clientId: string;
  strategy: StrategyFormView | null;
  providers: readonly { value: SocialProvider; label: string }[];
  metrics: readonly { value: string; label: string }[];
  periods: readonly { value: string; label: string }[];
  canEdit: boolean;
}) {
  const { pending, run } = useSave();
  const [objectives, setObjectives] = React.useState(strategy?.objectives ?? "");
  const [campaignGoals, setCampaignGoals] = React.useState(strategy?.campaignGoals ?? "");
  const [platforms, setPlatforms] = React.useState<SocialProvider[]>(strategy?.platforms ?? []);
  const [frequency, setFrequency] = React.useState<Partial<Record<SocialProvider, string>>>(
    Object.fromEntries(Object.entries(strategy?.postingFrequency ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [targets, setTargets] = React.useState(
    (strategy?.kpiTargets ?? []).map((t) => ({ ...t, target: String(t.target) })),
  );

  const toggle = (provider: SocialProvider) =>
    setPlatforms((current) =>
      current.includes(provider) ? current.filter((p) => p !== provider) : [...current, provider],
    );

  const save = () =>
    run(
      () =>
        saveStrategyAction({
          clientId,
          strategy: {
            objectives,
            campaignGoals,
            platforms,
            postingFrequency: Object.fromEntries(
              Object.entries(frequency).filter(([, v]) => v !== "" && v !== undefined),
            ),
            kpiTargets: targets.filter((t) => t.target !== ""),
          },
        }),
      "Strategy saved.",
    );

  return (
    <Card>
      <CardHeader>
        <div className="space-y-1">
          <CardTitle>Social strategy</CardTitle>
          <p className="text-xs text-ink-subtle">
          What has been agreed with the client. Targets are recorded, never marked achieved — see this
          week&apos;s posting beside the plan above.
        </p>
        </div>
      </CardHeader>
      <CardBody>
        <fieldset disabled={!canEdit || pending} className="space-y-4">
          <Field id="objectives" label="Objectives">
            {(aria) => <Textarea {...aria} rows={3} value={objectives} onChange={(e) => setObjectives(e.target.value)} />}
          </Field>

          <div>
            <p className="mb-1.5 text-sm font-medium text-navy-800">Platforms and posts per week</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {providers.map((provider) => {
                const on = platforms.includes(provider.value);
                return (
                  <li key={provider.value} className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
                    <label className="flex flex-1 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-red"
                        checked={on}
                        onChange={() => toggle(provider.value)}
                      />
                      {provider.label}
                    </label>
                    {on ? (
                      <label className="flex items-center gap-1.5 text-xs text-ink-subtle">
                        <Input
                          type="number"
                          min={0}
                          max={50}
                          className="h-8 w-16"
                          aria-label={`${provider.label} posts per week`}
                          value={frequency[provider.value] ?? ""}
                          onChange={(e) => setFrequency((f) => ({ ...f, [provider.value]: e.target.value }))}
                        />
                        / week
                      </label>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          <Field id="campaignGoals" label="Campaign goals">
            {(aria) => <Textarea {...aria} rows={2} value={campaignGoals} onChange={(e) => setCampaignGoals(e.target.value)} />}
          </Field>

          <div>
            <p className="mb-1.5 text-sm font-medium text-navy-800">KPI targets</p>
            {targets.length === 0 ? <p className="mb-2 text-xs text-ink-subtle">None agreed yet.</p> : null}
            <ul className="space-y-2">
              {targets.map((target, index) => (
                <li key={index} className="flex flex-wrap items-center gap-2">
                  <Select
                    aria-label="Metric"
                    className="h-9 w-44"
                    value={target.metric}
                    onChange={(e) => setTargets((all) => all.map((t, i) => (i === index ? { ...t, metric: e.target.value } : t)))}
                  >
                    {metrics.map((metric) => (
                      <option key={metric.value} value={metric.value}>
                        {metric.label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    aria-label="Target"
                    type="number"
                    min={0}
                    className="h-9 w-32"
                    value={target.target}
                    onChange={(e) => setTargets((all) => all.map((t, i) => (i === index ? { ...t, target: e.target.value } : t)))}
                  />
                  <Select
                    aria-label="Period"
                    className="h-9 w-36"
                    value={target.period}
                    onChange={(e) => setTargets((all) => all.map((t, i) => (i === index ? { ...t, period: e.target.value } : t)))}
                  >
                    {periods.map((period) => (
                      <option key={period.value} value={period.value}>
                        {period.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove target"
                    onClick={() => setTargets((all) => all.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
            {targets.length < 12 ? (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() =>
                  setTargets((all) => [...all, { metric: metrics[0]!.value, target: "", period: periods[0]!.value }])
                }
              >
                <Plus size={14} aria-hidden="true" />
                Add target
              </Button>
            ) : null}
          </div>

          {canEdit ? (
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save strategy"}
            </Button>
          ) : null}
        </fieldset>
      </CardBody>
    </Card>
  );
}

