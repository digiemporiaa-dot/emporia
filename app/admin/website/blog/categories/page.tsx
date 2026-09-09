import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { listCategories } from "@/lib/services/blog.service";
import { Card, CardBody } from "@/components/ui";
import { DeleteButton } from "@/components/admin/delete-button";
import { deleteCategoryAction } from "../../content-actions";
import { CategoryForm } from "./category-form";

export const metadata: Metadata = { title: "Blog categories" };

export default async function BlogCategoriesPage() {
  const actor = await requireActorPage("/admin/website/blog/categories");
  requirePermission(actor, "blog.view");

  const categories = await listCategories(actor);
  const canEdit = can(actor, "blog.edit");

  return (
    <>
      <header className="mb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-ink-subtle">
          <Link href="/admin/website/blog" className="hover:text-navy-800">
            Blog
          </Link>
          <span aria-hidden="true"> / </span>
          <span className="text-navy-700">Categories</span>
        </nav>
        <h1 className="mt-1.5 text-2xl text-navy-800">Categories</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-subtle">
          Deleting a category leaves its posts in place — they simply become uncategorised.
        </p>
      </header>

      <div className="max-w-2xl space-y-4">
        {categories.map((category) => (
          <Card key={category.id}>
            <CardBody className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-ink-subtle">
                  {category._count.posts} post{category._count.posts === 1 ? "" : "s"}
                </p>
                {can(actor, "blog.delete") ? (
                  <DeleteButton
                    id={category.id}
                    label={category.name}
                    description={
                      category._count.posts > 0
                        ? `${category._count.posts} post${category._count.posts === 1 ? "" : "s"} will become uncategorised. The posts themselves are kept.`
                        : "Nothing is using this category."
                    }
                    action={deleteCategoryAction}
                  />
                ) : null}
              </div>
              {canEdit ? (
                <CategoryForm
                  category={{
                    id: category.id,
                    name: category.name,
                    slug: category.slug,
                    description: category.description,
                  }}
                />
              ) : (
                <div>
                  <p className="font-medium text-navy-800">{category.name}</p>
                  <p className="font-mono text-xs text-ink-subtle">{category.slug}</p>
                </div>
              )}
            </CardBody>
          </Card>
        ))}

        {categories.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-sm text-ink-subtle">
            No categories yet. Posts do not need one.
          </p>
        ) : null}

        {can(actor, "blog.create") ? (
          <Card>
            <CardBody className="space-y-4">
              <h2 className="font-display text-lg text-navy-800">Add a category</h2>
              <CategoryForm />
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
