import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { listPosts } from "@/lib/services/blog.service";
import {
  Badge,
  Button,
  Table,
  TableEmpty,
  TableWrap,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";

export const metadata: Metadata = { title: "Blog" };

const dateFormat = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" });

export default async function BlogAdminPage() {
  const actor = await requireActorPage("/admin/website/blog");
  const posts = await listPosts(actor);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
            <Link href="/admin/website/pages" className="hover:text-navy-800">
              Website
            </Link>
            <span aria-hidden="true"> / </span>
            <span className="text-navy-700">Blog</span>
          </nav>
          <h1 className="mt-1.5 text-2xl text-navy-800">Blog</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/website/blog/categories">
            <Button size="sm" variant="secondary">
              Categories
            </Button>
          </Link>
          {can(actor, "blog.create") ? (
            <Link href="/admin/website/blog/new">
              <Button size="sm">Write a post</Button>
            </Link>
          ) : null}
        </div>
      </header>

      <TableWrap>
        <Table>
          <THead>
            <TR>
              <TH>Post</TH>
              <TH>Author</TH>
              <TH>Category</TH>
              <TH className="text-right">Tags</TH>
              <TH className="text-right">Read</TH>
              <TH>Published</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {posts.length === 0 ? (
              <TableEmpty
                colSpan={7}
                title="Nothing written yet"
                description="Blog bands on the site stay empty until there is a published post."
              />
            ) : (
              posts.map((post) => (
                <TR key={post.id}>
                  <TD>
                    <Link
                      href={`/admin/website/blog/${post.id}`}
                      className="font-medium text-navy-800 hover:text-brand-red"
                    >
                      {post.title}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-ink-subtle">{post.slug}</p>
                  </TD>
                  <TD className="text-ink-muted">{post.author.name}</TD>
                  <TD className="text-ink-muted">{post.category?.name ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{post._count.tags}</TD>
                  <TD className="text-right tabular-nums text-ink-subtle">
                    {post.readingMinutes} min
                  </TD>
                  <TD className="text-xs text-ink-muted">
                    {post.publishedAt ? dateFormat.format(post.publishedAt) : "—"}
                  </TD>
                  <TD>
                    <Badge tone={post.status === "PUBLISHED" ? "success" : "neutral"}>
                      {post.status}
                    </Badge>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableWrap>
    </>
  );
}
