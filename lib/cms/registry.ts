/**
 * What "content" is, in one place.
 *
 * Search and bulk operations both need the same facts about every content
 * type — what to call it, which permission governs it, how it expresses being
 * published, and where its edit screen is. Written twice, the two would
 * disagree the first time a type was added, and the disagreement would show up
 * as a record that can be found but not acted on, or acted on but never found.
 *
 * Types only, no database and no `server-only`: the admin screen imports this
 * to label its filters.
 */

import type { Permission } from "@/lib/auth/permissions";

export const CONTENT_TYPES = [
  "page",
  "reusableSection",
  "blogPost",
  "caseStudy",
  "testimonial",
  "faq",
  "service",
  "city",
  "servicePackage",
  "serviceCityPage",
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

export function isContentType(value: string): value is ContentType {
  return (CONTENT_TYPES as readonly string[]).includes(value);
}

/**
 * The three states a record can be in, normalised across two different shapes.
 *
 * Most types carry a `PublishStatus` enum. FAQs and cities carry a boolean —
 * they are switched on or off and have no archive. Rather than leak that
 * difference into every caller, both are described in one vocabulary, and the
 * registry says which states a type actually supports; asking for one it does
 * not support is refused with a reason rather than silently ignored.
 */
export type ContentState = "PUBLISHED" | "DRAFT" | "ARCHIVED";

export type ContentTypeMeta = {
  /** Singular label, shown on a row. */
  label: string;
  /** Plural label, shown on a filter and a group heading. */
  plural: string;
  /** Permission to see records of this type at all. */
  viewPermission: Permission;
  /** Permission to change one, where that is not a publish. */
  editPermission: Permission;
  /**
   * Permission to publish. Distinct from editing wherever the project draws
   * that line — an FAQ has no separate publish right, because switching one on
   * is an edit rather than an act of publication.
   */
  publishPermission: Permission;
  /** Which states this type can actually be in. */
  states: readonly ContentState[];
  /** Where a person goes to edit one. */
  href: (id: string) => string;
};

export const CONTENT_REGISTRY: Record<ContentType, ContentTypeMeta> = {
  page: {
    label: "Page",
    plural: "Pages",
    viewPermission: "pages.view",
    editPermission: "pages.edit",
    publishPermission: "pages.publish",
    states: ["PUBLISHED", "DRAFT", "ARCHIVED"],
    href: (id) => `/admin/website/pages/${id}`,
  },
  reusableSection: {
    label: "Reusable section",
    plural: "Reusable sections",
    viewPermission: "pages.view",
    editPermission: "pages.edit",
    publishPermission: "pages.publish",
    states: ["PUBLISHED", "DRAFT", "ARCHIVED"],
    href: (id) => `/admin/website/sections/${id}`,
  },
  blogPost: {
    label: "Blog post",
    plural: "Blog posts",
    viewPermission: "blog.view",
    editPermission: "blog.edit",
    publishPermission: "blog.publish",
    states: ["PUBLISHED", "DRAFT", "ARCHIVED"],
    href: (id) => `/admin/website/blog/${id}`,
  },
  caseStudy: {
    label: "Case study",
    plural: "Case studies",
    viewPermission: "casestudies.view",
    editPermission: "casestudies.edit",
    publishPermission: "casestudies.publish",
    states: ["PUBLISHED", "DRAFT", "ARCHIVED"],
    href: (id) => `/admin/website/case-studies/${id}`,
  },
  testimonial: {
    label: "Testimonial",
    plural: "Testimonials",
    viewPermission: "testimonials.view",
    editPermission: "testimonials.edit",
    publishPermission: "testimonials.publish",
    states: ["PUBLISHED", "DRAFT", "ARCHIVED"],
    href: (id) => `/admin/website/testimonials/${id}`,
  },
  faq: {
    label: "FAQ",
    plural: "FAQs",
    viewPermission: "faqs.view",
    editPermission: "faqs.edit",
    // No `faqs.publish` exists: an FAQ is switched on or off, which is an edit.
    publishPermission: "faqs.edit",
    states: ["PUBLISHED", "DRAFT"],
    href: (id) => `/admin/website/faqs/${id}`,
  },
  service: {
    label: "Service",
    plural: "Services",
    viewPermission: "catalog.view",
    editPermission: "catalog.edit",
    publishPermission: "catalog.publish",
    states: ["PUBLISHED", "DRAFT", "ARCHIVED"],
    href: (id) => `/admin/catalog/services/${id}`,
  },
  city: {
    label: "City",
    plural: "Cities",
    viewPermission: "catalog.view",
    editPermission: "catalog.edit",
    publishPermission: "catalog.edit",
    states: ["PUBLISHED", "DRAFT"],
    href: (id) => `/admin/catalog/cities/${id}`,
  },
  servicePackage: {
    label: "Package",
    plural: "Packages",
    viewPermission: "catalog.view",
    editPermission: "catalog.edit",
    publishPermission: "catalog.publish",
    states: ["PUBLISHED", "DRAFT", "ARCHIVED"],
    href: (id) => `/admin/catalog/packages/${id}`,
  },
  serviceCityPage: {
    label: "Service-city page",
    plural: "Service-city pages",
    viewPermission: "catalog.view",
    editPermission: "catalog.edit",
    publishPermission: "catalog.publish",
    // No archive: a local page is published or it is not (CLAUDE.md 9).
    states: ["PUBLISHED", "DRAFT"],
    href: (id) => `/admin/catalog/service-cities/${id}`,
  },
};

/** One row of a search result, whatever type it came from. */
export type ContentHit = {
  type: ContentType;
  id: string;
  title: string;
  /** The public address, where the type has one. */
  slug: string | null;
  state: ContentState;
  updatedAt: string;
  href: string;
};
