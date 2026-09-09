import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { getPost } from "@/lib/services/blog.service";
import { getEntitySeo } from "@/lib/services/seo.service";
import { db } from "@/lib/db";
import { EntitySeoPanel } from "@/components/admin/entity-seo-panel";
import { DeleteButton } from "@/components/admin/delete-button";
import { parseBody, postBodySchema } from "@/lib/content/entity-body";
import { deletePostAction } from "../../content-actions";
import { PostForm } from "../post-form";

export const metadata: Metadata = { title: "Post" };

export default async function PostDetailPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const actor = await requireActorPage(`/admin/website/blog/${postId}`);
  const post = await getPost(actor, postId);

  const seesSeo = can(actor, "seo.view");
  const [authors, categories, seo] = await Promise.all([
    db.user.findMany({
      where: { type: "STAFF", status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.blogCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    seesSeo ? getEntitySeo(actor, "blogPost", postId) : Promise.resolve(null),
  ]);

  const imageIds = [seo?.seo?.ogImageId, seo?.seo?.twitterImageId].filter((id): id is string =>
    Boolean(id),
  );
  const images = imageIds.length
    ? await db.media.findMany({
        where: { id: { in: imageIds } },
        select: { id: true, url: true, filename: true, type: true },
      })
    : [];
  const image = (id: string | null | undefined) =>
    (id ? images.find((row) => row.id === id) : null) ?? null;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/website/blog" className="hover:text-navy-800">
              Blog
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">{post.title}</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">{post.title}</h1>
          <p className="mt-1 text-xs text-ink-subtle">
            {post.readingMinutes} minute read, derived from the article text.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/blog/${post.slug}`}
            className="text-xs text-ink-muted underline-offset-4 hover:text-navy-800 hover:underline"
          >
            View on site
          </Link>
          {can(actor, "blog.delete") ? (
            <DeleteButton
              id={post.id}
              label={post.title}
              description="The post and its tag links are removed. This cannot be undone."
              action={deletePostAction}
              redirectTo="/admin/website/blog"
            />
          ) : null}
        </div>
      </header>

      <div className="max-w-3xl space-y-8">
        <PostForm
          authors={authors}
          categories={categories}
          post={{
            id: post.id,
            title: post.title,
            slug: post.slug,
            excerpt: post.excerpt,
            authorId: post.authorId,
            categoryId: post.categoryId,
            status: post.status,
            cover: post.cover
              ? {
                  id: post.cover.id,
                  url: post.cover.url,
                  filename: post.cover.alt ?? "Cover image",
                  type: "IMAGE",
                }
              : null,
            tags: post.tags.map((row) => row.tag.name),
            body: parseBody(postBodySchema, post.body),
          }}
        />

        {seo ? (
          <EntitySeoPanel
            entity="blogPost"
            id={post.id}
            seo={seo.seo}
            ogImage={image(seo.seo?.ogImageId)}
            twitterImage={image(seo.seo?.twitterImageId)}
            titleHint={post.title}
            canEdit={can(actor, "seo.edit")}
          />
        ) : null}
      </div>
    </>
  );
}
