import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Container, CtaButton, Eyebrow } from "@/components/website/primitives";
import { Breadcrumbs } from "@/components/website/breadcrumbs";
import { JsonLd } from "@/components/website/json-ld";
import { buildMetadata, privateMetadata } from "@/lib/seo/metadata";
import { seoSelect } from "@/lib/seo/select";
import { articleSchema } from "@/lib/seo/schema";
import { HeroReveal, Reveal } from "@/components/website/motion";
import { parseBody, postBodySchema } from "@/lib/content/entity-body";

export const revalidate = 3600;

const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

async function getPost(slug: string) {
  return db.blogPost.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      body: true,
      publishedAt: true,
      updatedAt: true,
      readingMinutes: true,
      seo: { select: seoSelect },
      author: { select: { name: true } },
      category: { select: { slug: true, name: true } },
      tags: { select: { tag: { select: { slug: true, name: true } } } },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return privateMetadata("Not found");

  return buildMetadata({
    path: `/blog/${post.slug}`,
    seo: post.seo,
    fallback: { title: post.title, description: post.excerpt },
    type: "article",
    publishedTime: post.publishedAt,
    modifiedTime: post.updatedAt,
  });
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  const body = parseBody(postBodySchema, post.body);

  // articleSchema returns null for a post with no publication date, so an
  // incomplete Article node is never emitted.
  const schema = await articleSchema({
    title: post.title,
    description: post.excerpt,
    path: `/blog/${post.slug}`,
    authorName: post.author.name,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    modifiedAt: post.updatedAt.toISOString(),
    imageUrl: post.seo?.ogImage?.url ?? null,
  });

  const related = await db.blogPost.findMany({
    where: {
      status: "PUBLISHED",
      id: { not: post.id },
      ...(post.category ? { category: { slug: post.category.slug } } : {}),
    },
    take: 2,
    orderBy: { publishedAt: "desc" },
    select: { id: true, slug: true, title: true, readingMinutes: true },
  });

  return (
    <>
      <JsonLd schema={schema} />

      <article>
        <section className="border-b border-line">
          <Container width="narrow" className="pt-10 pb-10 lg:pt-14">
            <HeroReveal>
              <Breadcrumbs
                crumbs={[
                  { name: "Home", path: "/" },
                  { name: "Insights", path: "/blog" },
                  ...(post.category
                    ? [{ name: post.category.name, path: `/blog/category/${post.category.slug}` }]
                    : []),
                  { name: post.title, path: `/blog/${post.slug}` },
                ]}
              />

              <h1 className="mt-7 text-4xl text-navy-800">{post.title}</h1>

              <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-4 text-xs text-ink-subtle">
                <span>{post.author.name}</span>
                {post.publishedAt ? (
                  <time dateTime={post.publishedAt.toISOString()}>
                    {DATE_FORMAT.format(post.publishedAt)}
                  </time>
                ) : null}
                <span>{post.readingMinutes} min read</span>
              </div>
            </HeroReveal>
          </Container>
        </section>

        <section>
          <Container width="narrow" className="py-12 lg:py-16">
            {body.lead ? (
              <Reveal>
                <p className="text-xl leading-relaxed text-navy-800">{body.lead}</p>
              </Reveal>
            ) : null}

            {body.sections && body.sections.length > 0 ? (
              <div className="mt-10 space-y-9">
                {body.sections.map((section) => (
                  <Reveal key={section.heading}>
                    <h2 className="font-display text-2xl text-navy-800">{section.heading}</h2>
                    <p className="mt-3 leading-relaxed text-ink-muted">{section.text}</p>
                  </Reveal>
                ))}
              </div>
            ) : null}

            {post.tags.length > 0 ? (
              <ul className="mt-12 flex flex-wrap gap-2 border-t border-line pt-6">
                {post.tags.map(({ tag }) => (
                  <li
                    key={tag.slug}
                    className="rounded-sm border border-line-strong px-2.5 py-1 text-xs capitalize text-ink-muted"
                  >
                    {tag.name}
                  </li>
                ))}
              </ul>
            ) : null}
          </Container>
        </section>
      </article>

      {related.length > 0 ? (
        <section className="border-t border-line bg-surface-muted">
          <Container width="narrow" className="py-12">
            <Eyebrow>Related</Eyebrow>
            <ul className="mt-5 border-t border-line">
              {related.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/blog/${item.slug}`}
                    className="group flex items-baseline justify-between gap-6 border-b border-line py-4"
                  >
                    <span className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                      {item.title}
                    </span>
                    <span className="shrink-0 text-xs text-ink-subtle">
                      {item.readingMinutes} min
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      ) : null}

      <section className="bg-navy-800 text-white">
        <Container width="narrow" className="py-14">
          <h2 className="text-2xl">Working on something similar?</h2>
          <p className="mt-3 max-w-lg text-navy-100">
            We are happy to talk through it, whether or not it turns into an engagement.
          </p>
          <div className="mt-6">
            <CtaButton href="/contact" size="lg">
              Get in touch
            </CtaButton>
          </div>
        </Container>
      </section>
    </>
  );
}
