import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { PostForm } from "../post-form";

export const metadata: Metadata = { title: "New post" };

export default async function NewPostPage() {
  const actor = await requireActorPage("/admin/website/blog/new");
  requirePermission(actor, "blog.create");

  const [authors, categories] = await Promise.all([
    db.user.findMany({
      where: { type: "STAFF", status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.blogCategory.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/website/blog" className="hover:text-navy-800">
            Blog
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">New</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Write a post</h1>
      </header>
      <div className="max-w-3xl">
        <PostForm authors={authors} categories={categories} />
      </div>
    </>
  );
}
