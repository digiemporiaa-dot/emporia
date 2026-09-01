import type { Metadata } from "next";
import Link from "next/link";
import { publishedPosts } from "@/lib/content/queries";
import { Container, Eyebrow } from "@/components/website/primitives";
import { HeroReveal, Stagger, StaggerItem } from "@/components/website/motion";

/**
 * Rendered at request time, with the underlying data cached and tagged.
 * A static route that reads the database would be prerendered at build,
 * forcing the container build to carry database credentials
 * (docs/ARCHITECTURE.md 17.2).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Insights",
  description: "Writing on SEO, paid media, content and marketing measurement.",
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default async function BlogPage() {
  const posts = await publishedPosts();

  return (
    <>
      <section className="border-b border-line">
        <Container className="pt-14 pb-12 lg:pt-20 lg:pb-16">
          <HeroReveal>
            <Eyebrow>Insights</Eyebrow>
            <h1 className="mt-4 max-w-3xl text-4xl text-navy-800">
              What we are working out, written down.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-muted">
              Notes from live engagements. Opinionated, occasionally inconvenient, and free of
              gated PDFs.
            </p>
          </HeroReveal>
        </Container>
      </section>

      <section>
        <Container className="py-12 lg:py-16">
          {posts.length === 0 ? (
            <p className="py-16 text-center text-ink-subtle">Nothing published yet.</p>
          ) : (
            <Stagger className="border-t border-line">
              {posts.map((post) => (
                <StaggerItem key={post.id}>
                  <article>
                    <Link
                      href={{ pathname: "/blog/[slug]", query: { slug: post.slug } }}
                      className="group grid gap-2 border-b border-line py-7 transition-colors hover:bg-surface-muted lg:grid-cols-12 lg:gap-8 lg:px-2"
                    >
                      <div className="lg:col-span-2">
                        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red">
                          {post.category?.name ?? "Article"}
                        </p>
                        {post.publishedAt ? (
                          <time
                            dateTime={post.publishedAt}
                            className="mt-1 block text-xs text-ink-subtle"
                          >
                            {DATE_FORMAT.format(new Date(post.publishedAt))}
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
          )}
        </Container>
      </section>
    </>
  );
}
