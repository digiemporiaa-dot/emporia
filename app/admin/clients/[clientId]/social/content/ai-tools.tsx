"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { AlertCircle, Lightbulb, Plus, Repeat2, Sparkles } from "lucide-react";
import { Badge, Button, Dialog, Field, Input, Select, Textarea } from "@/components/ui";
import { AIDraft } from "@/components/admin/ai-draft";
import type { SocialProvider } from "@/generated/prisma/enums";
import { addIdeaAction, createRepurposedAction, ideasAction, repurposeAction } from "./actions";

/**
 * The content page's two AI assists: repurposing an article into platform
 * versions, and suggesting ideas. Both produce drafts a person reviews in the
 * dialog first; neither creates anything until the person says so, and what
 * repurposing creates is marked as AI drafts until each version is saved.
 */

export type AiToolsProps = {
  clientId: string;
  projects: readonly { id: string; name: string; code: string }[];
  campaigns: readonly { id: string; name: string }[];
  pillars: readonly { id: string; name: string }[];
  blogPosts: readonly { id: string; title: string }[];
  /** Each platform, the formats it offers, and the one a repurposed post defaults to. */
  platforms: readonly {
    provider: SocialProvider;
    label: string;
    types: { value: string; label: string }[];
    defaultType: string;
    connected: boolean;
  }[];
};

function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: AiToolsProps["projects"];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field id="ai-project" label="Project" required>
      {(aria) => (
        <Select {...aria} value={value} onChange={(e) => onChange(e.target.value)}>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} — {project.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text">
      <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

export function AiTools(props: AiToolsProps) {
  const [open, setOpen] = React.useState<"repurpose" | "ideas" | null>(null);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen("repurpose")}>
        <Repeat2 size={14} aria-hidden="true" />
        Repurpose an article
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setOpen("ideas")}>
        <Lightbulb size={14} aria-hidden="true" />
        Suggest ideas
      </Button>
      {open === "repurpose" ? <RepurposeDialog {...props} onClose={() => setOpen(null)} /> : null}
      {open === "ideas" ? <IdeasDialog {...props} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Repurpose
// ---------------------------------------------------------------------------

type Repurposed = {
  title: string;
  sourceUrl: string | null;
  sourceBlogPostId: string | null;
  versions: {
    provider: SocialProvider;
    type: string;
    caption: string;
    headline: string | null;
    hashtags: string[];
    linkUrl: string | null;
    forbiddenUsed: string[];
  }[];
  carouselSlides: string[] | null;
  videoScript: string | null;
  model: string;
};

function RepurposeDialog({
  clientId,
  projects,
  campaigns,
  pillars,
  blogPosts,
  platforms,
  onClose,
}: AiToolsProps & { onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const [sourceKind, setSourceKind] = React.useState<"text" | "blog">("text");
  const [blogPostId, setBlogPostId] = React.useState(blogPosts[0]?.id ?? "");
  const [title, setTitle] = React.useState("");
  const [text, setText] = React.useState("");
  const [url, setUrl] = React.useState("");
  const anyConnected = platforms.some((p) => p.connected);
  const [chosen, setChosen] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(
      platforms
        .filter((p) => (anyConnected ? p.connected : p.provider === "LINKEDIN" || p.provider === "FACEBOOK"))
        .map((p) => [p.provider, p.defaultType]),
    ),
  );
  const [carousel, setCarousel] = React.useState(false);
  const [videoScript, setVideoScript] = React.useState(false);
  const [instruction, setInstruction] = React.useState("");
  const [pillarId, setPillarId] = React.useState("");

  const [result, setResult] = React.useState<Repurposed | null>(null);
  const [projectId, setProjectId] = React.useState(projects[0]?.id ?? "");
  const [campaignId, setCampaignId] = React.useState("");
  const [itemTitle, setItemTitle] = React.useState("");

  const generate = () => {
    setError(null);
    start(async () => {
      const response = await repurposeAction({
        clientId,
        pillarId: pillarId || null,
        source:
          sourceKind === "blog"
            ? { kind: "blog", blogPostId }
            : { kind: "text", title, text, url },
        targets: Object.entries(chosen).map(([provider, type]) => ({ provider, type })),
        carousel,
        videoScript,
        instruction,
      });
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setResult(response.data);
      setItemTitle(response.data.title);
    });
  };

  const create = () => {
    if (!result) return;
    setError(null);
    const brief = [
      `Repurposed from “${result.title}”${result.sourceUrl ? ` — ${result.sourceUrl}` : ""}.`,
      result.carouselSlides?.length
        ? `Carousel copy (AI draft):\n${result.carouselSlides.map((slide, i) => `${i + 1}. ${slide}`).join("\n")}`
        : "",
      result.videoScript ? `Video script (AI draft):\n${result.videoScript}` : "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 5_000);
    start(async () => {
      const response = await createRepurposedAction({
        clientId,
        projectId,
        campaignId: campaignId || null,
        pillarId: pillarId || null,
        title: itemTitle,
        brief,
        sourceBlogPostId: result.sourceBlogPostId,
        versions: result.versions.map(({ forbiddenUsed: _forbidden, ...version }) => version),
      });
      if (!response.ok) {
        setError(response.message);
        return;
      }
      onClose();
      router.push(`/admin/clients/${clientId}/social/content/${response.data.id}` as Route);
    });
  };

  const labelOf = (provider: SocialProvider) => platforms.find((p) => p.provider === provider)?.label ?? provider;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Repurpose an article"
      description="One article into a post per platform. Everything comes from the article; nothing is created until you say so."
    >
      <div className="space-y-4">
        <ErrorLine message={error} />

        {!result ? (
          <>
            {blogPosts.length > 0 ? (
              <div role="radiogroup" aria-label="Where the article comes from" className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" className="accent-brand-red" checked={sourceKind === "text"} onChange={() => setSourceKind("text")} />
                  Paste an article
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" className="accent-brand-red" checked={sourceKind === "blog"} onChange={() => setSourceKind("blog")} />
                  One of our blog posts
                </label>
              </div>
            ) : null}

            {sourceKind === "blog" ? (
              <Field id="ai-blog" label="Blog post">
                {(aria) => (
                  <Select {...aria} value={blogPostId} onChange={(e) => setBlogPostId(e.target.value)}>
                    {blogPosts.map((post) => (
                      <option key={post.id} value={post.id}>
                        {post.title}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <>
                <Field id="ai-title" label="Article title" required>
                  {(aria) => <Input {...aria} value={title} onChange={(e) => setTitle(e.target.value)} />}
                </Field>
                <Field id="ai-text" label="Article text" required hint="Paste the whole article. The posts will say nothing it does not.">
                  {(aria) => <Textarea {...aria} rows={6} value={text} onChange={(e) => setText(e.target.value)} />}
                </Field>
                <Field id="ai-url" label="Link to the article" hint="Optional. Added to platforms that take a link, with campaign tracking.">
                  {(aria) => <Input {...aria} type="url" value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />}
                </Field>
              </>
            )}

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-navy-800">Platforms</legend>
              <ul className="grid gap-2 sm:grid-cols-2">
                {platforms.map((platform) => {
                  const on = platform.provider in chosen;
                  return (
                    <li key={platform.provider} className="flex items-center gap-2 rounded-md border border-line px-3 py-2">
                      <label className="flex flex-1 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-brand-red"
                          checked={on}
                          onChange={() =>
                            setChosen((current) => {
                              const next = { ...current };
                              if (on) delete next[platform.provider];
                              else next[platform.provider] = platform.defaultType;
                              return next;
                            })
                          }
                        />
                        {platform.label}
                        {platform.connected ? null : <span className="text-2xs text-ink-subtle">(not connected)</span>}
                      </label>
                      {on ? (
                        <Select
                          aria-label={`${platform.label} format`}
                          className="h-8 w-36 text-xs"
                          value={chosen[platform.provider]}
                          onChange={(e) => setChosen((current) => ({ ...current, [platform.provider]: e.target.value }))}
                        >
                          {platform.types.map((type) => (
                            <option key={type.value} value={type.value}>
                              {type.label}
                            </option>
                          ))}
                        </Select>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </fieldset>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-brand-red" checked={carousel} onChange={(e) => setCarousel(e.target.checked)} />
                Carousel slide copy
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-brand-red" checked={videoScript} onChange={(e) => setVideoScript(e.target.checked)} />
                Short video script
              </label>
            </div>

            {pillars.length > 0 ? (
              <Field id="ai-pillar" label="Content pillar">
                {(aria) => (
                  <Select {...aria} value={pillarId} onChange={(e) => setPillarId(e.target.value)}>
                    <option value="">No pillar</option>
                    {pillars.map((pillar) => (
                      <option key={pillar.id} value={pillar.id}>
                        {pillar.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}

            <Field id="ai-steer" label="Steer" hint="Optional — e.g. lead with the practical tips.">
              {(aria) => <Input {...aria} value={instruction} onChange={(e) => setInstruction(e.target.value)} />}
            </Field>

            <Button onClick={generate} disabled={pending || Object.keys(chosen).length === 0}>
              <Sparkles size={14} aria-hidden="true" />
              {pending ? "Writing…" : "Write the posts"}
            </Button>
          </>
        ) : (
          <>
            <AIDraft model={result.model} onDismiss={() => setResult(null)}>
              <div className="space-y-3">
                {result.versions.map((version, index) => (
                  <div key={version.provider} className="rounded-md border border-line bg-white p-3">
                    <p className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium text-navy-800">
                      {labelOf(version.provider)}
                      <span className="font-normal text-ink-subtle">{version.type.toLowerCase().replace(/_/g, " ")}</span>
                    </p>
                    {version.headline ? <p className="mb-1 text-sm font-medium text-navy-800">{version.headline}</p> : null}
                    <Textarea
                      aria-label={`${labelOf(version.provider)} caption`}
                      rows={4}
                      value={version.caption}
                      onChange={(e) =>
                        setResult((current) =>
                          current
                            ? {
                                ...current,
                                versions: current.versions.map((v, i) => (i === index ? { ...v, caption: e.target.value } : v)),
                              }
                            : current,
                        )
                      }
                    />
                    {version.hashtags.length > 0 ? (
                      <p className="mt-1 text-xs text-navy-700">{version.hashtags.map((tag) => `#${tag}`).join(" ")}</p>
                    ) : null}
                    {version.linkUrl ? <p className="mt-1 truncate text-2xs text-ink-subtle">Link: {version.linkUrl}</p> : null}
                    {version.forbiddenUsed.length > 0 ? (
                      <p role="alert" className="mt-1.5 rounded-md border border-red-100 bg-red-50 px-2.5 py-1.5 text-xs text-brand-red-text">
                        Uses forbidden words: {version.forbiddenUsed.join(", ")}.
                      </p>
                    ) : null}
                  </div>
                ))}
                {result.carouselSlides?.length ? (
                  <div className="rounded-md border border-line bg-white p-3 text-sm">
                    <p className="mb-1 text-xs font-medium text-navy-800">Carousel slides</p>
                    <ol className="list-decimal space-y-0.5 pl-5 text-ink">
                      {result.carouselSlides.map((slide, i) => (
                        <li key={i}>{slide}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                {result.videoScript ? (
                  <div className="rounded-md border border-line bg-white p-3 text-sm">
                    <p className="mb-1 text-xs font-medium text-navy-800">Video script</p>
                    <p className="whitespace-pre-wrap text-ink">{result.videoScript}</p>
                  </div>
                ) : null}
              </div>
            </AIDraft>

            {projects.length === 0 ? (
              <p className="text-sm text-ink-muted">This client has no active project to file the idea under. Create one first.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="ai-item-title" label="Idea title" required>
                  {(aria) => <Input {...aria} value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} />}
                </Field>
                <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
                <Field id="ai-campaign" label="Campaign">
                  {(aria) => (
                    <Select {...aria} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                      <option value="">No campaign</option>
                      {campaigns.map((campaign) => (
                        <option key={campaign.id} value={campaign.id}>
                          {campaign.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            )}

            <p className="text-xs text-ink-subtle">
              Each version is created as a draft marked <Badge tone="warning">AI draft</Badge> and cannot go to the
              client until someone checks and saves it.
            </p>
            <Button onClick={create} disabled={pending || projects.length === 0 || !itemTitle.trim()}>
              {pending ? "Creating…" : `Create the idea with ${result.versions.length} version${result.versions.length === 1 ? "" : "s"}`}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Ideas
// ---------------------------------------------------------------------------

function IdeasDialog({
  clientId,
  projects,
  campaigns,
  pillars,
  onClose,
}: AiToolsProps & { onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [campaignId, setCampaignId] = React.useState("");
  const [pillarId, setPillarId] = React.useState("");
  const [count, setCount] = React.useState("5");
  const [instruction, setInstruction] = React.useState("");
  const [projectId, setProjectId] = React.useState(projects[0]?.id ?? "");
  const [ideas, setIdeas] = React.useState<
    { title: string; brief: string; pillarId: string | null; pillarName: string | null; addedId?: string }[] | null
  >(null);
  const [model, setModel] = React.useState("");

  const suggest = () => {
    setError(null);
    start(async () => {
      const response = await ideasAction({ clientId, campaignId: campaignId || null, pillarId: pillarId || null, count, instruction });
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setIdeas(response.data.ideas);
      setModel(response.data.model);
    });
  };

  const add = (index: number) => {
    const idea = ideas?.[index];
    if (!idea) return;
    setError(null);
    start(async () => {
      const response = await addIdeaAction({
        clientId,
        projectId,
        campaignId: campaignId || null,
        pillarId: idea.pillarId,
        title: idea.title,
        brief: idea.brief,
      });
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setIdeas((current) => current?.map((item, i) => (i === index ? { ...item, addedId: response.data.id } : item)) ?? null);
      router.refresh();
    });
  };

  return (
    <Dialog open onClose={onClose} title="Suggest ideas" description="Suggestions to choose from. Only the ones you add become content.">
      <div className="space-y-4">
        <ErrorLine message={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ideas-campaign" label="For a campaign">
            {(aria) => (
              <Select {...aria} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">Any</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {pillars.length > 0 ? (
            <Field id="ideas-pillar" label="For a pillar">
              {(aria) => (
                <Select {...aria} value={pillarId} onChange={(e) => setPillarId(e.target.value)}>
                  <option value="">Any</option>
                  {pillars.map((pillar) => (
                    <option key={pillar.id} value={pillar.id}>
                      {pillar.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <Field id="ideas-count" label="How many">
            {(aria) => (
              <Select {...aria} value={count} onChange={(e) => setCount(e.target.value)}>
                {[3, 5, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="ideas-steer" label="Steer">
            {(aria) => <Input {...aria} value={instruction} placeholder="Optional" onChange={(e) => setInstruction(e.target.value)} />}
          </Field>
        </div>
        <Button onClick={suggest} disabled={pending}>
          <Sparkles size={14} aria-hidden="true" />
          {pending && !ideas ? "Thinking…" : ideas ? "Suggest again" : "Suggest"}
        </Button>

        {ideas ? (
          <AIDraft model={model} onDismiss={() => setIdeas(null)}>
            {ideas.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing new came back. Try a different steer.</p>
            ) : (
              <div className="space-y-3">
                {projects.length > 0 ? (
                  <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
                ) : (
                  <p className="text-sm text-ink-muted">This client has no active project to add ideas under.</p>
                )}
                <ul className="divide-y divide-line">
                  {ideas.map((idea, index) => (
                    <li key={idea.title} className="flex flex-wrap items-start gap-3 py-3 first:pt-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-navy-800">{idea.title}</p>
                        <p className="text-xs text-ink-muted">{idea.brief}</p>
                        {idea.pillarName ? <Badge tone="neutral">{idea.pillarName}</Badge> : null}
                      </div>
                      {idea.addedId ? (
                        <Link
                          href={`/admin/clients/${clientId}/social/content/${idea.addedId}` as Route}
                          className="text-xs text-brand-red underline underline-offset-4"
                        >
                          Added — open
                        </Link>
                      ) : (
                        <Button size="sm" variant="secondary" disabled={pending || projects.length === 0} onClick={() => add(index)}>
                          <Plus size={13} aria-hidden="true" />
                          Add
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </AIDraft>
        ) : null}
      </div>
    </Dialog>
  );
}
