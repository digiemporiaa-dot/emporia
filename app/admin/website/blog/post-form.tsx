"use client";

import * as React from "react";
import { useActionState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button, Card, CardBody, Field, Input, Select, Textarea } from "@/components/ui";
import { MediaPicker, type PickedMedia } from "@/components/admin/media-picker";
import { FormStatus, SubmitButton, fieldErrors, useHydrated } from "@/components/admin/form-status";
import type { PostBody } from "@/lib/content/entity-body";
import { savePostAction, type SavedState } from "../content-actions";

/**
 * Blog post editor.
 *
 * The body is a standfirst plus headed sections — the shape the public article
 * template renders, and the shape `postBodySchema` validates. Reading time is
 * not a field: it is derived from this text on save, because a number an editor
 * has to remember to update is a number that goes stale.
 */

export type PostValues = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  authorId: string;
  categoryId: string | null;
  status: string;
  cover: PickedMedia | null;
  tags: string[];
  body: PostBody;
};

type Section = { heading: string; text: string };

export function PostForm({
  post,
  authors,
  categories,
}: {
  post?: PostValues;
  authors: readonly { id: string; name: string }[];
  categories: readonly { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState<SavedState, FormData>(savePostAction, null);
  const errors = fieldErrors(state);
  const err = (name: string) => errors[name]?.[0];
  // This form posts its long-form content as JSON only React writes, so saving
  // waits for hydration — see useHydrated.
  const ready = useHydrated();

  const [lead, setLead] = React.useState(post?.body.lead ?? "");
  const [sections, setSections] = React.useState<Section[]>(post?.body.sections ?? []);
  const [tags, setTags] = React.useState<string[]>(post?.tags ?? []);
  const [tagDraft, setTagDraft] = React.useState("");

  const body: PostBody = {
    ...(lead.trim() ? { lead: lead.trim() } : {}),
    ...(sections.length > 0 ? { sections } : {}),
  };

  const addTag = () => {
    const value = tagDraft.trim();
    // Case-insensitive, because the service slugifies before matching anyway.
    if (!value || tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) {
      setTagDraft("");
      return;
    }
    setTags([...tags, value]);
    setTagDraft("");
  };

  const patch = (index: number, changes: Partial<Section>) =>
    setSections(sections.map((s, i) => (i === index ? { ...s, ...changes } : s)));

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {post ? <input type="hidden" name="id" value={post.id} /> : null}
      <input type="hidden" name="body" value={JSON.stringify(body)} />
      <input type="hidden" name="tags" value={JSON.stringify(tags)} />

      <FormStatus state={state} savedMessage="Post saved." />

      <Card>
        <CardBody className="space-y-5">
          <Field id="title" label="Title" required error={err("title")}>
            {(aria) => <Input {...aria} name="title" defaultValue={post?.title} required />}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="slug" label="Slug" required hint="/blog/<slug>" error={err("slug")}>
              {(aria) => <Input {...aria} name="slug" defaultValue={post?.slug} required />}
            </Field>
            <Field id="status" label="Status" error={err("status")}>
              {(aria) => (
                <Select {...aria} name="status" defaultValue={post?.status ?? "DRAFT"}>
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Published</option>
                  <option value="ARCHIVED">Archived</option>
                </Select>
              )}
            </Field>
          </div>

          <Field
            id="excerpt"
            label="Excerpt"
            hint="Shown on the index and in cards. Falls back to nothing if blank."
            error={err("excerpt")}
          >
            {(aria) => (
              <Textarea {...aria} name="excerpt" defaultValue={post?.excerpt ?? ""} rows={2} />
            )}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="authorId" label="Author" required error={err("authorId")}>
              {(aria) => (
                <Select {...aria} name="authorId" defaultValue={post?.authorId ?? ""} required>
                  <option value="">Choose an author…</option>
                  {authors.map((author) => (
                    <option key={author.id} value={author.id}>
                      {author.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="categoryId" label="Category" error={err("categoryId")}>
              {(aria) => (
                <Select {...aria} name="categoryId" defaultValue={post?.categoryId ?? ""}>
                  <option value="">Uncategorised</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <MediaPicker name="coverId" label="Cover image" value={post?.cover ?? null} />

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium tracking-wide text-ink-muted">Tags</legend>
            {tags.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <li
                    key={tag}
                    className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-muted px-2 py-1 text-xs text-navy-800"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((t) => t !== tag))}
                      className="text-ink-subtle hover:text-brand-red"
                    >
                      <X size={12} aria-hidden="true" />
                      <span className="sr-only">Remove tag {tag}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex gap-2">
              <Input
                value={tagDraft}
                aria-label="Add a tag"
                placeholder="Local SEO"
                onChange={(event) => setTagDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter adds the tag rather than submitting the whole form.
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addTag();
                }}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={addTag}
                disabled={tags.length >= 20}
              >
                Add
              </Button>
            </div>
            <p className="text-xs text-ink-subtle">
              A tag that does not exist yet is created on save.
            </p>
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-5">
          <h2 className="font-display text-lg text-navy-800">Article</h2>

          <Field id="lead" label="Standfirst" hint="The larger opening paragraph.">
            {(aria) => (
              <Textarea
                {...aria}
                value={lead}
                onChange={(event) => setLead(event.target.value)}
                rows={3}
              />
            )}
          </Field>

          <div className="space-y-3">
            {sections.map((section, index) => (
              <div key={index} className="rounded-md border border-line bg-surface-muted p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-3">
                    <Field id={`section-${index}-heading`} label={`Section ${index + 1} heading`}>
                      {(aria) => (
                        <Input
                          {...aria}
                          value={section.heading}
                          onChange={(event) => patch(index, { heading: event.target.value })}
                        />
                      )}
                    </Field>
                    <Field id={`section-${index}-text`} label="Text">
                      {(aria) => (
                        <Textarea
                          {...aria}
                          value={section.text}
                          rows={5}
                          onChange={(event) => patch(index, { text: event.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-6"
                    onClick={() => setSections(sections.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    <span className="sr-only">Remove section {index + 1}</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setSections([...sections, { heading: "", text: "" }])}
            disabled={sections.length >= 40}
          >
            <Plus size={14} aria-hidden="true" />
            Add section
          </Button>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <SubmitButton ready={ready} label={post ? "Save post" : "Create post"} />
      </div>
    </form>
  );
}
