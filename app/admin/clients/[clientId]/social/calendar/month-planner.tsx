"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CalendarRange, Sparkles } from "lucide-react";
import { Badge, Button, Dialog, Field, Input, Select, useToast } from "@/components/ui";
import { AIDraft } from "@/components/admin/ai-draft";
import type { SocialProvider } from "@/generated/prisma/enums";
import { createPlanAction, planMonthAction } from "./actions";

/**
 * Plan a month with the AI's help.
 *
 * The person sets how often to post and what the month is about; the counts
 * shown are arithmetic done here and again on the server, never the model's.
 * The plan comes back as a draft to read and prune. Only ticked items become
 * content, as draft ideas with empty platform versions — nothing is written,
 * approved or scheduled for publishing by this dialog.
 */

export type MonthPlannerProps = {
  clientId: string;
  months: { value: string; label: string }[];
  defaultMonth: string;
  platforms: { provider: SocialProvider; label: string; connected: boolean; types: { value: string; label: string }[] }[];
  /** The strategy's posts per week, per platform. */
  frequency: Partial<Record<SocialProvider, number>>;
  pillars: readonly { id: string; name: string }[];
  campaigns: readonly { id: string; name: string }[];
  projects: readonly { id: string; name: string; code: string }[];
  /** The client's occasions across `months`, one row per day. */
  occasions: { occasionId: string; name: string; day: string }[];
};

type Plan = {
  month: string;
  model: string;
  targets: Partial<Record<SocialProvider, number>>;
  planned: Partial<Record<SocialProvider, number>>;
  items: {
    day: string;
    title: string;
    brief: string;
    pillarId: string | null;
    pillarName: string | null;
    campaignId: string | null;
    campaignName: string | null;
    occasionId: string | null;
    occasionName: string | null;
    versions: { provider: SocialProvider; type: string }[];
  }[];
};

function daysIn(month: string): number {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

const dayLabel = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function MonthPlanner(props: MonthPlannerProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <CalendarRange size={14} aria-hidden="true" />
        Plan a month
      </Button>
      {open ? <PlannerDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function PlannerDialog({
  clientId,
  months,
  defaultMonth,
  platforms,
  frequency,
  pillars,
  campaigns,
  projects,
  occasions,
  onClose,
}: MonthPlannerProps & { onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [month, setMonth] = React.useState(defaultMonth);
  const [perWeek, setPerWeek] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(platforms.map((p) => [p.provider, String(frequency[p.provider] ?? 0)])),
  );
  const [pillarIds, setPillarIds] = React.useState<string[]>([]);
  const [campaignIds, setCampaignIds] = React.useState<string[]>([]);
  const [skippedOccasions, setSkippedOccasions] = React.useState<string[]>([]);
  const [instruction, setInstruction] = React.useState("");
  const [plan, setPlan] = React.useState<Plan | null>(null);
  const [kept, setKept] = React.useState<boolean[]>([]);
  const [projectId, setProjectId] = React.useState(projects[0]?.id ?? "");

  const monthOccasions = occasions.filter((o) => o.day.startsWith(`${month}-`));
  const days = daysIn(month);
  const counts = platforms
    .map((p) => ({ ...p, count: Math.round((Math.max(0, Number(perWeek[p.provider]) || 0) * days) / 7) }))
    .filter((p) => p.count > 0);
  const total = counts.reduce((sum, p) => sum + p.count, 0);
  const labelOf = (provider: SocialProvider) => platforms.find((p) => p.provider === provider)?.label ?? provider;
  const typeOf = (provider: SocialProvider, type: string) =>
    platforms.find((p) => p.provider === provider)?.types.find((t) => t.value === type)?.label ?? type;

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const draft = () => {
    setError(null);
    start(async () => {
      const response = await planMonthAction({
        clientId,
        month,
        frequency: Object.fromEntries(counts.map((p) => [p.provider, Number(perWeek[p.provider])])),
        pillarIds,
        campaignIds,
        occasionIds: [...new Set(monthOccasions.map((o) => o.occasionId))].filter((id) => !skippedOccasions.includes(id)),
        instruction,
      });
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setPlan(response.data);
      setKept(response.data.items.map(() => true));
    });
  };

  const create = () => {
    if (!plan) return;
    setError(null);
    const items = plan.items
      .filter((_, index) => kept[index])
      .map((item) => ({
        day: item.day,
        title: item.title,
        brief: item.brief,
        pillarId: item.pillarId,
        campaignId: item.campaignId,
        occasionId: item.occasionId,
        versions: item.versions,
      }));
    start(async () => {
      const response = await createPlanAction({ clientId, projectId, month: plan.month, items });
      if (!response.ok) {
        setError(response.message);
        return;
      }
      push({
        tone: "success",
        title: `${response.data.created} idea${response.data.created === 1 ? "" : "s"} added as drafts.`,
        description: "Each platform version is empty and marked as an AI draft until someone writes and saves it.",
      });
      onClose();
      router.refresh();
    });
  };

  const keptCount = kept.filter(Boolean).length;

  return (
    <Dialog
      open
      onClose={onClose}
      className="w-[min(46rem,calc(100vw-2rem))]"
      title="Plan a month"
      description="A draft plan to read and prune. Only the items you keep become content, as drafts."
    >
      <div className="space-y-4">
        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text">
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}

        {!plan ? (
          <>
            <Field id="plan-month" label="Month">
              {(aria) => (
                <Select {...aria} value={month} onChange={(e) => setMonth(e.target.value)}>
                  {months.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-navy-800">Posts per week</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {platforms.map((platform) => (
                  <label key={platform.provider} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 text-sm">
                    <span>
                      {platform.label}
                      {!platform.connected ? <span className="ml-1.5 text-2xs text-ink-subtle">not connected</span> : null}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={21}
                      className="h-8 w-20"
                      aria-label={`${platform.label} posts per week`}
                      value={perWeek[platform.provider] ?? "0"}
                      onChange={(e) => setPerWeek((current) => ({ ...current, [platform.provider]: e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              <p className="text-xs text-ink-subtle">
                {total === 0
                  ? "Set at least one platform."
                  : `${total} posts in ${months.find((m) => m.value === month)?.label ?? month}: ${counts
                      .map((p) => `${p.count} ${p.label}`)
                      .join(", ")}.`}
                {total > 90 ? " That is more than 90 — plan a smaller month." : ""}
              </p>
            </fieldset>

            {pillars.length > 0 ? (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium text-navy-800">Pillars</legend>
                <p className="text-xs text-ink-subtle">Leave all unticked to spread the month across every pillar.</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {pillars.map((pillar) => (
                    <label key={pillar.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-brand-red"
                        checked={pillarIds.includes(pillar.id)}
                        onChange={() => setPillarIds((list) => toggle(list, pillar.id))}
                      />
                      {pillar.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {campaigns.length > 0 ? (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium text-navy-800">Campaigns to support</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {campaigns.map((campaign) => (
                    <label key={campaign.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-brand-red"
                        checked={campaignIds.includes(campaign.id)}
                        onChange={() => setCampaignIds((list) => toggle(list, campaign.id))}
                      />
                      {campaign.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-navy-800">Occasions this month</legend>
              {monthOccasions.length === 0 ? (
                <p className="text-xs text-ink-subtle">
                  None. Occasions are chosen on the client&rsquo;s brand page; moving festivals need their date in the
                  occasion library first.
                </p>
              ) : (
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {monthOccasions.map((occasion) => (
                    <label key={`${occasion.occasionId}-${occasion.day}`} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="accent-brand-red"
                        checked={!skippedOccasions.includes(occasion.occasionId)}
                        onChange={() => setSkippedOccasions((list) => toggle(list, occasion.occasionId))}
                      />
                      {occasion.name}
                      <span className="text-2xs text-ink-subtle">{dayLabel.format(new Date(`${occasion.day}T00:00:00Z`))}</span>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <Field id="plan-steer" label="Steer">
              {(aria) => (
                <Input {...aria} value={instruction} placeholder="Optional — e.g. lean on the monsoon sale" onChange={(e) => setInstruction(e.target.value)} />
              )}
            </Field>

            <Button onClick={draft} disabled={pending || total === 0 || total > 90}>
              <Sparkles size={14} aria-hidden="true" />
              {pending ? "Planning…" : "Draft the plan"}
            </Button>
          </>
        ) : (
          <AIDraft model={plan.model} onDismiss={() => setPlan(null)}>
            <div className="space-y-3">
              <ul className="flex flex-wrap gap-2" aria-label="Posts planned against asked">
                {(Object.keys(plan.targets) as SocialProvider[]).map((provider) => {
                  const target = plan.targets[provider] ?? 0;
                  const planned = plan.planned[provider] ?? 0;
                  return (
                    <li key={provider}>
                      <Badge tone={planned < target ? "warning" : "neutral"}>
                        {labelOf(provider)}: {planned} of {target}
                        {planned < target ? ` — ${target - planned} short` : ""}
                      </Badge>
                    </li>
                  );
                })}
              </ul>

              {plan.items.length === 0 ? (
                <p className="text-sm text-ink-muted">Nothing usable came back. Try again, or change the steer.</p>
              ) : (
                <ul className="max-h-[45vh] divide-y divide-line overflow-y-auto rounded-md border border-line bg-white">
                  {plan.items.map((item, index) => (
                    <li key={`${item.day}-${item.title}`} className="flex gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        className="mt-1 accent-brand-red"
                        aria-label={`Keep ${item.title}`}
                        checked={kept[index] ?? false}
                        onChange={() => setKept((list) => list.map((value, i) => (i === index ? !value : value)))}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm">
                          <span className="mr-2 text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                            {dayLabel.format(new Date(`${item.day}T00:00:00Z`))}
                          </span>
                          <span className="font-medium text-navy-800">{item.title}</span>
                        </p>
                        <p className="text-xs text-ink-muted">{item.brief}</p>
                        <div className="flex flex-wrap gap-1">
                          {item.occasionName ? <Badge tone="navy">{item.occasionName}</Badge> : null}
                          {item.pillarName ? <Badge tone="neutral">{item.pillarName}</Badge> : null}
                          {item.campaignName ? <Badge tone="neutral">{item.campaignName}</Badge> : null}
                          {item.versions.map((version) => (
                            <Badge key={version.provider} tone="neutral">
                              {labelOf(version.provider)} · {typeOf(version.provider, version.type)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {plan.items.length > 0 ? (
                projects.length > 0 ? (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-56 flex-1">
                      <Field id="plan-project" label="Project" required>
                        {(aria) => (
                          <Select {...aria} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                            {projects.map((project) => (
                              <option key={project.id} value={project.id}>
                                {project.code} — {project.name}
                              </option>
                            ))}
                          </Select>
                        )}
                      </Field>
                    </div>
                    <Button onClick={create} disabled={pending || keptCount === 0 || !projectId}>
                      {pending ? "Adding…" : `Add ${keptCount} idea${keptCount === 1 ? "" : "s"} as drafts`}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-ink-muted">This client has no active project to add the plan under.</p>
                )
              ) : null}
            </div>
          </AIDraft>
        )}
      </div>
    </Dialog>
  );
}
