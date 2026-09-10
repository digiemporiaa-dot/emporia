import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { CACHE_TAGS } from "@/lib/content/queries";
import { slugify, uniqueSlug } from "@/lib/utils/slug";
import { resolveTagIds } from "@/lib/services/tags";
import { SchemaType } from "@/generated/prisma/enums";
import type { InputJsonValue } from "@/generated/prisma/internal/prismaNamespace";
import type { Actor } from "@/lib/actor/types";
import type { BlogCategoryInput, BlogPostInput } from "@/lib/validation/content";

/**
 * Blog posts, categories and tags.
 *
 * The models and the public routes have always existed; the demo seed was the
 * only writer. This is the admin write path.
 *
 * Two things are derived rather than typed by hand, because a field an editor
 * has to remember to update is a field that goes stale:
 *
 *   readingMinutes  from the body's word count
 *   publishedAt     set the first time a post reaches PUBLISHED, kept after
 */

/** 200 words a minute, floored at one. A conventional figure, not a measured one. */
const WORDS_PER_MINUTE = 200;

function readingMinutes(body: BlogPostInput["body"]): number {
  const text = [body.lead ?? "", ...(body.sections ?? []).flatMap((s) => [s.heading, s.text])].join(
    " ",
  );
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export async function listPosts(actor: Actor) {
  requirePermission(actor, "blog.view");

  return db.blogPost.findMany({
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      publishedAt: true,
      readingMinutes: true,
      author: { select: { name: true } },
      category: { select: { name: true } },
      _count: { select: { tags: true } },
    },
  });
}

export type PostRow = Awaited<ReturnType<typeof listPosts>>[number];

export async function getPost(actor: Actor, id: string) {
  requirePermission(actor, "blog.view");

  const post = await db.blogPost.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      body: true,
      coverId: true,
      cover: { select: { id: true, url: true, alt: true } },
      authorId: true,
      categoryId: true,
      status: true,
      publishedAt: true,
      readingMinutes: true,
      seoId: true,
      seo: { select: { id: true, metaTitle: true, metaDescription: true } },
      tags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
    },
  });

  if (!post) throw new NotFoundError("That post does not exist.");
  return post;
}

async function assertPostSlugFree(slug: string, excludeId?: string): Promise<void> {
  const clash = await db.blogPost.findFirst({
    where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    const message = "Another post already uses that slug.";
    throw new ConflictError(message, { slug: [message] });
  }
}


export async function createPost(actor: Actor, input: BlogPostInput) {
  requirePermission(actor, "blog.create");
  if (input.status === "PUBLISHED") requirePermission(actor, "blog.publish");
  await assertPostSlugFree(input.slug);

  const post = await withAudit(
    { actor, action: "CREATE", entityType: "BlogPost", entityId: input.slug },
    async (tx) => {
      const seo = await tx.seo.create({ data: { schemaType: SchemaType.ARTICLE } });

      const created = await tx.blogPost.create({
        data: {
          title: input.title,
          slug: input.slug,
          excerpt: input.excerpt,
          body: input.body as InputJsonValue,
          coverId: input.coverId,
          authorId: input.authorId,
          categoryId: input.categoryId,
          status: input.status,
          publishedAt: input.status === "PUBLISHED" ? new Date() : null,
          readingMinutes: readingMinutes(input.body),
          seoId: seo.id,
        },
      });

      const tagIds = await resolveTagIds(tx.blogTag, input.tags);
      if (tagIds.length > 0) {
        await tx.blogPostTag.createMany({
          data: tagIds.map((tagId) => ({ postId: created.id, tagId })),
          skipDuplicates: true,
        });
      }

      return created;
    },
  );

  revalidateTag(CACHE_TAGS.posts);
  return post;
}

export async function updatePost(actor: Actor, id: string, input: BlogPostInput) {
  requirePermission(actor, "blog.edit");

  const before = await getPost(actor, id);
  if (input.status === "PUBLISHED" && before.status !== "PUBLISHED") {
    requirePermission(actor, "blog.publish");
  }
  await assertPostSlugFree(input.slug, id);

  const post = await withAudit(
    { actor, action: "UPDATE", entityType: "BlogPost", entityId: id, before },
    async (tx) => {
      const updated = await tx.blogPost.update({
        where: { id },
        data: {
          title: input.title,
          slug: input.slug,
          excerpt: input.excerpt,
          body: input.body as InputJsonValue,
          coverId: input.coverId,
          authorId: input.authorId,
          categoryId: input.categoryId,
          status: input.status,
          // Set once and kept: unpublishing and republishing must not rewrite
          // the date the post went out, which readers and feeds have seen.
          publishedAt: before.publishedAt ?? (input.status === "PUBLISHED" ? new Date() : null),
          readingMinutes: readingMinutes(input.body),
        },
      });

      // Replaced wholesale rather than diffed: the submitted list is the list.
      await tx.blogPostTag.deleteMany({ where: { postId: id } });
      const tagIds = await resolveTagIds(tx.blogTag, input.tags);
      if (tagIds.length > 0) {
        await tx.blogPostTag.createMany({
          data: tagIds.map((tagId) => ({ postId: id, tagId })),
          skipDuplicates: true,
        });
      }

      return updated;
    },
  );

  revalidateTag(CACHE_TAGS.posts);
  return post;
}

export async function deletePost(actor: Actor, id: string) {
  requirePermission(actor, "blog.delete");

  const before = await getPost(actor, id);

  await withAudit({ actor, action: "DELETE", entityType: "BlogPost", entityId: id, before }, (tx) =>
    tx.blogPost.delete({ where: { id } }),
  );

  revalidateTag(CACHE_TAGS.posts);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(actor: Actor) {
  requirePermission(actor, "blog.view");

  return db.blogCategory.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      _count: { select: { posts: true } },
    },
  });
}

export async function createCategory(actor: Actor, input: BlogCategoryInput) {
  requirePermission(actor, "blog.create");

  const clash = await db.blogCategory.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  });
  if (clash) {
    const message = "Another category already uses that slug.";
    throw new ConflictError(message, { slug: [message] });
  }

  const category = await withAudit(
    { actor, action: "CREATE", entityType: "BlogCategory", entityId: input.slug },
    (tx) => tx.blogCategory.create({ data: input }),
  );

  revalidateTag(CACHE_TAGS.posts);
  return category;
}

export async function updateCategory(actor: Actor, id: string, input: BlogCategoryInput) {
  requirePermission(actor, "blog.edit");

  const before = await db.blogCategory.findUnique({ where: { id } });
  if (!before) throw new NotFoundError("That category does not exist.");

  const clash = await db.blogCategory.findFirst({
    where: { slug: input.slug, id: { not: id } },
    select: { id: true },
  });
  if (clash) {
    const message = "Another category already uses that slug.";
    throw new ConflictError(message, { slug: [message] });
  }

  const category = await withAudit(
    { actor, action: "UPDATE", entityType: "BlogCategory", entityId: id, before },
    (tx) => tx.blogCategory.update({ where: { id }, data: input }),
  );

  revalidateTag(CACHE_TAGS.posts);
  return category;
}

/**
 * Delete a category.
 *
 * `BlogPost.categoryId` is `onDelete: SetNull`, so its posts survive and simply
 * become uncategorised. That is the right outcome — losing a category must not
 * lose the writing — but it is worth being explicit that it happens.
 */
export async function deleteCategory(actor: Actor, id: string) {
  requirePermission(actor, "blog.delete");

  const before = await db.blogCategory.findUnique({
    where: { id },
    select: { id: true, name: true, slug: true, _count: { select: { posts: true } } },
  });
  if (!before) throw new NotFoundError("That category does not exist.");

  await withAudit(
    { actor, action: "DELETE", entityType: "BlogCategory", entityId: id, before },
    (tx) => tx.blogCategory.delete({ where: { id } }),
  );

  revalidateTag(CACHE_TAGS.posts);
}

/** A slug proposal for the "new post" form. Never collides with an existing one. */
export async function suggestPostSlug(actor: Actor, title: string): Promise<string> {
  requirePermission(actor, "blog.create");
  const base = slugify(title);
  if (!base) return "";
  return uniqueSlug(
    base,
    async (candidate) => (await db.blogPost.count({ where: { slug: candidate } })) > 0,
  );
}
