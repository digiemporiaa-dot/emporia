import type { Metadata } from "next";
import Link from "next/link";
import { requireActorPage } from "@/lib/actor";
import { can, requirePermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { Card, CardBody } from "@/components/ui";
import type { Permission } from "@/lib/auth/permissions";

export const metadata: Metadata = { title: "Website" };
export const dynamic = "force-dynamic";

/**
 * Website hub.
 *
 * The public site is assembled from two things: pages built out of blocks, and
 * the content library those blocks query. Until the library had an admin, half
 * of that was invisible here — a blog band could be placed on a page with no
 * way to write a post for it. This lists both halves in one place.
 */
export default async function WebsiteHubPage() {
  const actor = await requireActorPage("/admin/website");
  requirePermission(actor, "pages.view");

  const [
    pages,
    livePages,
    sections,
    posts,
    livePosts,
    studies,
    liveStudies,
    quotes,
    liveQuotes,
    faqs,
  ] = await Promise.all([
    db.page.count({ where: { deletedAt: null } }),
    db.page.count({ where: { deletedAt: null, status: "PUBLISHED" } }),
    db.reusableSection.count({ where: { deletedAt: null } }),
    db.blogPost.count(),
    db.blogPost.count({ where: { status: "PUBLISHED" } }),
    db.caseStudy.count(),
    db.caseStudy.count({ where: { status: "PUBLISHED" } }),
    db.testimonial.count(),
    db.testimonial.count({ where: { status: "PUBLISHED" } }),
    db.fAQ.count({ where: { serviceCityPageId: null } }),
  ]);

  const published = (live: number, total: number) => `${live} published of ${total}`;

  const sectionsList: {
    href: string;
    title: string;
    detail: string;
    description: string;
    permission: Permission;
  }[] = [
    {
      href: "/admin/website/pages",
      title: "Pages",
      detail: published(livePages, pages),
      description:
        "Every page of the public site, built from blocks. The homepage is one of these.",
      permission: "pages.view",
    },
    {
      href: "/admin/website/sections",
      title: "Reusable sections",
      detail: `${sections} section${sections === 1 ? "" : "s"}`,
      description: "Authored once, placed on many pages. Publishing one updates every placement.",
      permission: "pages.view",
    },
    {
      href: "/admin/website/blog",
      title: "Blog",
      detail: published(livePosts, posts),
      description: "Posts, categories and tags. Blog bands on any page read from here.",
      permission: "blog.view",
    },
    {
      href: "/admin/website/case-studies",
      title: "Case studies",
      detail: published(liveStudies, studies),
      description: "Client work and the metrics agreed with them. Nothing here is calculated.",
      permission: "casestudies.view",
    },
    {
      href: "/admin/website/testimonials",
      title: "Testimonials",
      detail: published(liveQuotes, quotes),
      description: "Quotes attributed to named people, optionally tied to a service or city.",
      permission: "testimonials.view",
    },
    {
      href: "/admin/website/faqs",
      title: "FAQs",
      detail: `${faqs} question${faqs === 1 ? "" : "s"}`,
      description: "Questions attached to a service, a city or a package.",
      permission: "faqs.view",
    },
  ];

  const visible = sectionsList.filter((section) => can(actor, section.permission));

  return (
    <>
      <header className="mb-7">
        <p className="text-2xs font-semibold uppercase tracking-widest text-brand-red-text">
          Website
        </p>
        <h1 className="mt-1.5 text-2xl text-navy-800">Pages and the content they render</h1>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((section) => (
          <Link key={section.href} href={{ pathname: section.href }} className="group">
            <Card className="h-full transition-colors group-hover:border-navy-300">
              <CardBody>
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-display text-lg text-navy-800 group-hover:text-brand-red">
                    {section.title}
                  </h2>
                  <span className="text-xs tabular-nums text-ink-subtle">{section.detail}</span>
                </div>
                <p className="mt-2 text-xs text-ink-subtle">{section.description}</p>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
