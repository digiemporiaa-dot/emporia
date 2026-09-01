import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Container, Eyebrow } from "@/components/website/primitives";
import { Breadcrumbs } from "@/components/website/breadcrumbs";
import { HeroReveal, Stagger, StaggerItem } from "@/components/website/motion";
import { buildMetadata, privateMetadata } from "@/lib/seo/metadata";
import { seoSelect } from "@/lib/seo/select";

export const revalidate = 3600;

const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

async function getCategory(slug: string) {
  return db.blogCategory.findFirst({
    where: { slug, posts: { some: { status: "PUBLISHED" } } },
    select: {
      slug: true,
      name: true,
      description: true,
      seo: { select: seoSelect },
      posts: {
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        select: {
          id: true,
          slug: true,
          title: true,
          excerpt: true,
          publishedAt: true,
          readingMinutes: true,
        },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) return privateMetadata("Not found");

  return buildMetadata({
    path: `/blog/category/${category.slug}`,
    seo: category.seo,
    fallback: {
      title: `${category.name} insights`,
      description:
        category.description ?? `Writing from Emporia on ${category.name.toLowerCase()}.`,
    },
  });
}

export default async function BlogCategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) notFound();

  return (
    <>
      <section className="border-b border-line">
        <Container className="pt-10 pb-12 lg:pt-14 lg:pb-16">
          <HeroReveal>
            <Breadcrumbs
              crumbs={[
                { name: "Home", path: "/" },
                { name: "Insights", path: "/blog" },
                { name: category.name, path: `/blog/category/${category.slug}` },
              ]}
            />
            <Eyebrow className="mt-8">Category</Eyebrow>
            <h1 className="mt-4 text-4xl text-navy-800">{category.name}</h1>
            {category.description ? (
              <p className="mt-5 max-w-xl text-lg text-ink-muted">{category.description}</p>
            ) : null}
          </HeroReveal>
        </Container>
      </section>

      <section>
        <Container className="py-12 lg:py-16">
          <Stagger className="border-t border-line">
            {category.posts.map((post) => (
              <StaggerItem key={post.id}>
                <article>
                  <Link
                    href={{ pathname: "/blog/[slug]", query: { slug: post.slug } }}
                    className="group grid gap-2 border-b border-line py-6 transition-colors hover:bg-surface-muted lg:grid-cols-12 lg:gap-8 lg:px-2"
                  >
                    <div className="lg:col-span-2">
                      {post.publishedAt ? (
                        <time
                          dateTime={post.publishedAt.toISOString()}
                          className="text-xs text-ink-subtle"
                        >
                          {DATE_FORMAT.format(post.publishedAt)}
                        </time>
                      ) : null}
                    </div>
                    <div className="lg:col-span-8">
                      <h2 className="font-display text-xl text-navy-800 transition-colors group-hover:text-brand-red">
                        {post.title}
                      </h2>
                      {post.excerpt ? (
                        <p className="mt-2 max-w-2xl text-ink-muted">{post.excerpt}</p>
                      ) : null}
                    </div>
                    <p className="text-xs text-ink-subtle lg:col-span-2 lg:text-right">
                      {post.readingMinutes} min read
                    </p>
                  </Link>
                </article>
              </StaggerItem>
            ))}
          </Stagger>
        </Container>
      </section>
    </>
  );
}
