import * as React from "react";
import { Container, CtaButton, Eyebrow, IndexNumber } from "@/components/website/primitives";
import { HeroReveal, Reveal, Stagger, StaggerItem } from "@/components/website/motion";
import type { ParsedSection } from "@/lib/content/sections";
import {
  FeatureBlock,
  HeadingBlock,
  ImageBlock,
  ImageBoxBlock,
  ImageTextBlock,
  RichTextBlock,
  TableBlock,
  type BlockImages,
} from "@/components/website/blocks";

/**
 * Renderer for CMS page sections.
 *
 * Each section type gets its own designed band rather than a single generic
 * block, so a CMS-driven page still has rhythm. Sections arrive already
 * validated (lib/content/sections), so this only concerns itself with layout.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function formatUpdated(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DATE_FORMAT.format(date);
}

/**
 * Section types that render the page's <h1> themselves.
 *
 * `hero` emits one from its own heading; `legal` emits one from the page title.
 * Every other type — including every builder block, which is capped at h2 —
 * leaves the page without a level-one heading, so one has to be supplied.
 */
const EMITS_H1 = new Set(["hero", "legal"]);

export function PageSections({
  sections,
  title,
  images = {},
}: {
  sections: readonly ParsedSection[];
  /**
   * Page title, used as the <h1> for section types that carry no heading of
   * their own (legal pages). Every page needs exactly one level-one heading —
   * a document title alone is not one.
   */
  title?: string;
  /** Images referenced by builder blocks, resolved by the query in one batch. */
  images?: BlockImages;
}) {
  // A page assembled from builder blocks would otherwise ship with no <h1> at
  // all: an accessibility failure and an SEO one. Rendered only when nothing
  // else provides it, so the hand-composed pages are untouched.
  const needsTitle = Boolean(title) && !sections.some((section) => EMITS_H1.has(section.type));

  return (
    <>
      {needsTitle ? (
        <header className="border-b border-line">
          <Container className="pt-12 pb-8 lg:pt-16 lg:pb-10">
            <h1 className="max-w-3xl text-4xl text-navy-800">{title}</h1>
          </Container>
        </header>
      ) : null}
      {sections.map((section) => {
        switch (section.type) {
          case "hero":
            return (
              <section key={section.id} className="border-b border-line">
                <Container className="pt-14 pb-12 lg:pt-20 lg:pb-16">
                  <HeroReveal>
                    {section.content.eyebrow ? <Eyebrow>{section.content.eyebrow}</Eyebrow> : null}
                    <h1 className="mt-4 max-w-3xl text-4xl text-navy-800">
                      {section.content.heading}
                    </h1>
                    {section.content.body ? (
                      <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted">
                        {section.content.body}
                      </p>
                    ) : null}
                    {section.content.ctaLabel && section.content.ctaHref ? (
                      <div className="mt-8">
                        <CtaButton href={{ pathname: section.content.ctaHref }} size="lg">
                          {section.content.ctaLabel}
                        </CtaButton>
                      </div>
                    ) : null}
                  </HeroReveal>
                </Container>
              </section>
            );

          case "prose":
            return (
              <section key={section.id} className="border-b border-line">
                <Container className="py-14 lg:py-20">
                  <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
                    {section.content.heading ? (
                      <div className="lg:col-span-4">
                        <Reveal>
                          <h2 className="text-2xl text-navy-800">{section.content.heading}</h2>
                        </Reveal>
                      </div>
                    ) : null}
                    <div className={section.content.heading ? "lg:col-span-7 lg:col-start-6" : "lg:col-span-8"}>
                      <Reveal delay={0.06}>
                        <div className="space-y-5">
                          {section.content.paragraphs.map((paragraph) => (
                            <p
                              key={paragraph.slice(0, 40)}
                              className="text-lg leading-relaxed text-ink-muted"
                            >
                              {paragraph}
                            </p>
                          ))}
                        </div>
                      </Reveal>
                    </div>
                  </div>
                </Container>
              </section>
            );

          case "values":
            return (
              <section key={section.id} className="border-b border-line bg-surface-muted">
                <Container className="py-14 lg:py-20">
                  {section.content.heading ? (
                    <Reveal>
                      <h2 className="text-2xl text-navy-800">{section.content.heading}</h2>
                    </Reveal>
                  ) : null}
                  <Stagger className="mt-8 grid gap-x-10 border-t border-line sm:grid-cols-2">
                    {section.content.items.map((item, index) => (
                      <StaggerItem key={item.title}>
                        <div className="flex gap-4 border-b border-line py-6">
                          <IndexNumber value={index + 1} tone="red" className="pt-1.5" />
                          <div>
                            <h3 className="font-display text-lg text-navy-800">{item.title}</h3>
                            <p className="mt-1.5 text-ink-muted">{item.text}</p>
                          </div>
                        </div>
                      </StaggerItem>
                    ))}
                  </Stagger>
                </Container>
              </section>
            );

          case "roles":
            return (
              <section key={section.id} className="border-b border-line">
                <Container className="py-14 lg:py-20">
                  {section.content.heading ? (
                    <Reveal>
                      <Eyebrow>Open roles</Eyebrow>
                      <h2 className="mt-4 text-2xl text-navy-800">{section.content.heading}</h2>
                    </Reveal>
                  ) : null}

                  {section.content.items.length === 0 ? (
                    // Empty state rather than invented listings (CLAUDE.md 2 rule 5).
                    <Reveal delay={0.06}>
                      <p className="mt-6 max-w-xl text-lg text-ink-muted">
                        {section.content.emptyMessage ?? "No open roles at the moment."}
                      </p>
                    </Reveal>
                  ) : (
                    <ul className="mt-8 border-t border-line">
                      {section.content.items.map((role) => (
                        <li
                          key={role.title}
                          className="grid gap-2 border-b border-line py-5 lg:grid-cols-12 lg:items-baseline lg:gap-6"
                        >
                          <h3 className="font-display text-lg text-navy-800 lg:col-span-5">
                            {role.title}
                          </h3>
                          <p className="text-sm text-ink-muted lg:col-span-5">
                            {role.summary ?? ""}
                          </p>
                          <p className="text-xs text-ink-subtle lg:col-span-2 lg:text-right">
                            {[role.location, role.type].filter(Boolean).join(" · ")}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </Container>
              </section>
            );

          case "legal": {
            const updated = section.content.updatedAt ? formatUpdated(section.content.updatedAt) : null;
            return (
              <section key={section.id}>
                <Container width="narrow" className="py-12 lg:py-16">
                  {title ? (
                    <h1 className="mb-6 text-4xl text-navy-800">{title}</h1>
                  ) : null}
                  {updated ? (
                    <p className="text-xs text-ink-subtle">Last updated {updated}</p>
                  ) : null}
                  {section.content.intro ? (
                    <p className="mt-5 text-lg leading-relaxed text-navy-800">
                      {section.content.intro}
                    </p>
                  ) : null}
                  <div className="mt-10 space-y-8">
                    {section.content.clauses.map((clause, index) => (
                      <div key={clause.heading} className="border-t border-line pt-5">
                        <div className="flex items-baseline gap-3">
                          <IndexNumber value={index + 1} />
                          <h2 className="font-display text-lg text-navy-800">{clause.heading}</h2>
                        </div>
                        <p className="mt-2.5 leading-relaxed text-ink-muted">{clause.text}</p>
                      </div>
                    ))}
                  </div>
                </Container>
              </section>
            );
          }

          case "cta":
            return (
              <section key={section.id} className="bg-navy-800 text-white">
                <Container className="py-14 lg:py-18">
                  <div className="grid gap-6 lg:grid-cols-12 lg:items-end">
                    <div className="lg:col-span-7">
                      <h2 className="text-3xl">{section.content.heading}</h2>
                      {section.content.body ? (
                        <p className="mt-4 max-w-xl text-navy-100">{section.content.body}</p>
                      ) : null}
                    </div>
                    <div className="lg:col-span-4 lg:col-start-9 lg:text-right">
                      <CtaButton href={{ pathname: section.content.ctaHref }} size="lg">
                        {section.content.ctaLabel}
                      </CtaButton>
                    </div>
                  </div>
                </Container>
              </section>
            );

          // --- builder blocks -------------------------------------------
          case "heading":
            return <HeadingBlock key={section.id} content={section.content} />;
          case "richText":
            return <RichTextBlock key={section.id} content={section.content} />;
          case "image":
            return <ImageBlock key={section.id} content={section.content} images={images} />;
          case "imageBox":
            return <ImageBoxBlock key={section.id} content={section.content} images={images} />;
          case "imageText":
            return <ImageTextBlock key={section.id} content={section.content} images={images} />;
          case "table":
            return <TableBlock key={section.id} content={section.content} />;
          case "feature":
            return <FeatureBlock key={section.id} content={section.content} images={images} />;

          // Homepage-only section types are composed bespokely on that route.
          default:
            return null;
        }
      })}
    </>
  );
}
