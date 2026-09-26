import type { Column, TransferMeta } from "@/lib/transfer/types";

/**
 * The five content types a spreadsheet can carry, and what their columns mean.
 *
 * Only flat, human-typable fields are here. A service's `body`, a post's
 * `body`, any media reference and the SEO record are **not** importable and
 * are listed in `omits` so the screen can say so: they are structured JSON or
 * an opaque id, a CSV cannot express either honestly, and a blank cell that
 * silently wiped a page's content would be the worst possible behaviour.
 *
 * That leads to the rule the whole importer turns on: **a column absent from
 * the file is left exactly as it is.** Somebody who exports, deletes every
 * column but `slug` and `status`, and imports the file back has published some
 * records — not blanked everything else about them.
 */

const ID: Column = {
  header: "id",
  kind: "text",
  note: "Leave blank to create. Filled in by export; keep it to update that record.",
};

export const TRANSFER_TYPES = ["service", "city", "blogPost", "testimonial", "faq"] as const;

export type TransferType = (typeof TRANSFER_TYPES)[number];

export function isTransferType(value: string): value is TransferType {
  return (TRANSFER_TYPES as readonly string[]).includes(value);
}

export const TRANSFER: Record<TransferType, TransferMeta> = {
  service: {
    label: "Service",
    plural: "Services",
    viewPermission: "catalog.view",
    createPermission: "catalog.create",
    editPermission: "catalog.edit",
    naturalKey: "slug",
    omits: ["the page body", "the hero image", "the SEO record"],
    columns: [
      ID,
      { header: "slug", kind: "text", note: "The public address. Unique; also how a row without an id is matched." },
      { header: "name", kind: "text", note: "Required." },
      { header: "shortDescription", kind: "text", note: "One line, used across the site. Required." },
      { header: "icon", kind: "text", note: "One of the curated icon names, or blank." },
      { header: "status", kind: "status", note: "DRAFT, PUBLISHED or ARCHIVED. Publishing needs catalog.publish." },
      { header: "order", kind: "number", note: "Sort position. Lower comes first." },
    ],
  },

  city: {
    label: "City",
    plural: "Cities",
    viewPermission: "catalog.view",
    createPermission: "catalog.create",
    editPermission: "catalog.edit",
    naturalKey: "slug",
    omits: ["the SEO record"],
    columns: [
      ID,
      { header: "slug", kind: "text", note: "The public address. Unique; also how a row without an id is matched." },
      { header: "name", kind: "text", note: "Required." },
      { header: "state", kind: "text", note: "Required." },
      { header: "country", kind: "text", note: "Defaults to India." },
      { header: "latitude", kind: "number", note: "-90 to 90, or blank." },
      { header: "longitude", kind: "number", note: "-180 to 180, or blank." },
      { header: "population", kind: "number", note: "Whole number, or blank." },
      { header: "isActive", kind: "boolean", note: "yes or no. An inactive city and its local pages are hidden." },
      { header: "order", kind: "number", note: "Sort position. Lower comes first." },
    ],
  },

  blogPost: {
    label: "Blog post",
    plural: "Blog posts",
    viewPermission: "blog.view",
    createPermission: "blog.create",
    editPermission: "blog.edit",
    naturalKey: "slug",
    omits: ["the post body", "the cover image", "the SEO record"],
    columns: [
      ID,
      { header: "slug", kind: "text", note: "The public address. Unique; also how a row without an id is matched." },
      { header: "title", kind: "text", note: "Required." },
      { header: "excerpt", kind: "text", note: "Shown on listings. Blank for none." },
      { header: "author", kind: "ref", note: "The author's email address. Required on a new post." },
      { header: "category", kind: "ref", note: "A blog category slug, or blank." },
      { header: "tags", kind: "list", note: "Separated by semicolons. A tag that does not exist is created." },
      { header: "status", kind: "status", note: "DRAFT, PUBLISHED or ARCHIVED. Publishing needs blog.publish." },
    ],
  },

  testimonial: {
    label: "Testimonial",
    plural: "Testimonials",
    viewPermission: "testimonials.view",
    createPermission: "testimonials.create",
    editPermission: "testimonials.edit",
    // Nothing about a testimonial is unique — two people at the same company
    // can say much the same thing — so a row with no id always creates.
    naturalKey: null,
    omits: ["the author's photo"],
    columns: [
      ID,
      { header: "authorName", kind: "text", note: "Who said it. Required." },
      { header: "authorRole", kind: "text", note: "Their job title, or blank." },
      { header: "company", kind: "text", note: "Their company, or blank." },
      { header: "quote", kind: "text", note: "What they said. Required." },
      { header: "rating", kind: "number", note: "1 to 5, or blank for no rating." },
      { header: "service", kind: "ref", note: "A service slug, or blank." },
      { header: "city", kind: "ref", note: "A city slug, or blank." },
      { header: "status", kind: "status", note: "DRAFT, PUBLISHED or ARCHIVED. Publishing needs testimonials.publish." },
      { header: "order", kind: "number", note: "Sort position. Lower comes first." },
    ],
  },

  faq: {
    label: "FAQ",
    plural: "FAQs",
    viewPermission: "faqs.view",
    createPermission: "faqs.create",
    editPermission: "faqs.edit",
    // The same question is legitimately asked of two different services, so
    // the question is not a key either.
    naturalKey: null,
    omits: [],
    columns: [
      ID,
      { header: "question", kind: "text", note: "Required." },
      { header: "answer", kind: "text", note: "Required." },
      { header: "service", kind: "ref", note: "A service slug, or blank." },
      { header: "city", kind: "ref", note: "A city slug, or blank." },
      { header: "package", kind: "ref", note: "A package slug, or blank." },
      { header: "isActive", kind: "boolean", note: "yes or no. An inactive FAQ is not shown." },
      { header: "order", kind: "number", note: "Sort position. Lower comes first." },
    ],
  },
};
