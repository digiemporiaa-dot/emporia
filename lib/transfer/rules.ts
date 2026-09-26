import "server-only";
import { db } from "@/lib/db";
import type { Actor } from "@/lib/actor/types";
import type { Refs } from "@/lib/transfer/refs";
import type { TransferType } from "@/lib/transfer/columns";
import type { Status } from "@/lib/transfer/cells";
import {
  readBoolean,
  readList,
  readNumber,
  readStatus,
  writeBoolean,
  writeList,
  writeNumber,
  writeText,
  type Read,
} from "@/lib/transfer/cells";
import {
  blogPostSchema,
  faqSchema,
  serviceSchema,
  testimonialSchema,
  type BlogPostInput,
  type FaqInput,
  type ServiceInput,
  type TestimonialInput,
} from "@/lib/validation/content";
import { citySchema, type CityInput } from "@/lib/validation/local";
import { ICON_NAMES } from "@/lib/content/icons";
import * as blog from "@/lib/services/blog.service";
import * as cities from "@/lib/services/city.service";
import * as faqs from "@/lib/services/faq.service";
import * as services from "@/lib/services/service.service";
import * as testimonials from "@/lib/services/testimonial.service";
import type { z } from "zod";

/**
 * How each content type maps to a row, in both directions.
 *
 * One rule per column, carrying all three jobs that column has: read a cell
 * into a value, take the same value off an existing record, and write it back
 * out on export. Keeping them together is what stops the three drifting — a
 * column that exports one thing and imports another is a data-loss bug that
 * only shows up after somebody round-trips their whole catalogue.
 *
 * **Writing goes through the ordinary service functions.** `createService`,
 * `updatePost` and the rest already hold the permission check, the publish
 * check, the slug collision check, the audit row and the cache invalidation.
 * An importer with its own Prisma writes would be a second copy of all of
 * that, and the copy is what would be missing a permission check in a year.
 */

export type Rule = {
  /** The column this reads, matched loosely by `readTable`. */
  column: string;
  /** The key it sets on the service input. */
  field: string;
  /**
   * What an empty cell means for this column, on an update. Stated per column
   * rather than inferred, because both answers are silent data changes when
   * they are wrong, and which one is right is a fact about the field.
   *
   * `clear` — the field can genuinely be unset, and a blank cell unsets it: an
   * excerpt, a latitude, an attached city.
   * `keep` — there is no empty value for the field to take, so a blank cell is
   * an operator who did not fill that column in: a status, a yes/no flag, a
   * sort position. Treating those as "set it to nothing" would unpublish or
   * reorder records nobody touched.
   */
  blank: "keep" | "clear";
  /** Cell → value. */
  read: (raw: string, refs: Refs) => Read<unknown>;
  /** Existing record → the same value, so an absent column changes nothing. */
  current: (row: Record<string, unknown>) => unknown;
  /** Record → cell, for export. */
  write: (row: Record<string, unknown>) => string;
};

/**
 * A string field, with the empty string counted as absent.
 *
 * It matters for the row labels below: a row whose `name` cell is blank is
 * exactly the row that failed validation, and labelling it "" leaves the
 * operator an error with nothing to identify it by. Falling through to the
 * slug gives them something to search the file for.
 */
const str = (row: Record<string, unknown>, key: string) =>
  typeof row[key] === "string" && row[key] !== "" ? (row[key] as string) : null;
const num = (row: Record<string, unknown>, key: string) =>
  typeof row[key] === "number" ? (row[key] as number) : null;

/** A required or optional piece of text. Blank stays blank; the schema judges it. */
function text(column: string, field = column): Rule {
  return {
    column,
    field,
    blank: "clear",
    read: (raw) => ({ ok: true, value: raw.trim() }),
    current: (row) => str(row, field) ?? "",
    write: (row) => writeText(str(row, field)),
  };
}

function number(column: string, blank: "keep" | "clear", field = column): Rule {
  return {
    column,
    field,
    blank,
    read: (raw) => readNumber(raw),
    current: (row) => num(row, field),
    write: (row) => writeNumber(num(row, field)),
  };
}

function boolean(column: string, field = column): Rule {
  return {
    column,
    field,
    blank: "keep",
    read: (raw) => readBoolean(raw),
    current: (row) => row[field] === true,
    write: (row) => writeBoolean(row[field] === true),
  };
}

function status(column: string, allowed: readonly Status[]): Rule {
  return {
    column,
    field: "status",
    blank: "keep",
    read: (raw) => readStatus(raw, allowed),
    current: (row) => str(row, "status"),
    write: (row) => writeText(str(row, "status")),
  };
}

/**
 * Another record, named the way a person would name it.
 *
 * A blank cell means "not attached", which is a real instruction and is obeyed.
 * A value nothing matches is an error naming the value — never a silent null,
 * which would quietly detach every FAQ in a file with one misspelt slug.
 */
function ref(
  column: string,
  field: string,
  pick: (refs: Refs) => ReadonlyMap<string, string>,
  what: string,
  /** The record's own field holding the human-readable value, for export. */
  exportFrom: (row: Record<string, unknown>) => string | null,
): Rule {
  return {
    column,
    field,
    blank: "clear",
    read: (raw, refs) => {
      const value = raw.trim();
      if (value === "") return { ok: true, value: null };
      const id = pick(refs).get(value.toLowerCase());
      if (!id) return { ok: false, message: `No ${what} called "${value}".` };
      return { ok: true, value: id };
    },
    current: (row) => str(row, field),
    write: (row) => writeText(exportFrom(row)),
  };
}

const nested = (row: Record<string, unknown>, key: string, inner: string): string | null => {
  const value = row[key];
  if (value === null || typeof value !== "object") return null;
  const found = (value as Record<string, unknown>)[inner];
  return typeof found === "string" ? found : null;
};

// ---------------------------------------------------------------------------
// The five types
// ---------------------------------------------------------------------------

export type TypeRules = {
  rules: readonly Rule[];
  /**
   * Validates the merged input. The parsed value is what gets written, and it
   * is what `create` and `update` below are handed — the cast at each call
   * site is sound because the schema on the same entry produced the value.
   */
  schema: z.ZodType<unknown>;
  /** A short name for the row, used in the preview and in error messages. */
  label: (row: Record<string, unknown>) => string;
  /** Everything a merge needs, plus whatever `write` reads for export. */
  load: (ids: readonly string[]) => Promise<Record<string, unknown>[]>;
  all: () => Promise<Record<string, unknown>[]>;
  /** Find by natural key, for a row with no id. */
  findNatural: ((value: string) => Promise<string | null>) | null;
  create: (actor: Actor, input: unknown) => Promise<{ id: string }>;
  update: (actor: Actor, id: string, input: unknown) => Promise<{ id: string }>;
};

const PUBLISHABLE: readonly Status[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];

const serviceSelect = {
  id: true,
  name: true,
  slug: true,
  shortDescription: true,
  icon: true,
  heroMediaId: true,
  status: true,
  order: true,
  body: true,
} as const;

const citySelect = {
  id: true,
  name: true,
  slug: true,
  state: true,
  country: true,
  latitude: true,
  longitude: true,
  population: true,
  isActive: true,
  order: true,
} as const;

const postSelect = {
  id: true,
  title: true,
  slug: true,
  excerpt: true,
  coverId: true,
  authorId: true,
  categoryId: true,
  status: true,
  body: true,
  author: { select: { email: true } },
  category: { select: { slug: true } },
  tags: { select: { tag: { select: { name: true } } } },
} as const;

const testimonialSelect = {
  id: true,
  authorName: true,
  authorRole: true,
  company: true,
  quote: true,
  rating: true,
  avatarId: true,
  serviceId: true,
  cityId: true,
  status: true,
  order: true,
  service: { select: { slug: true } },
  city: { select: { slug: true } },
} as const;

const faqSelect = {
  id: true,
  question: true,
  answer: true,
  serviceId: true,
  cityId: true,
  packageId: true,
  order: true,
  isActive: true,
  service: { select: { slug: true } },
  city: { select: { slug: true } },
  package: { select: { slug: true } },
} as const;

/** Tags arrive as join rows and leave as a semicolon list. */
function tagNames(row: Record<string, unknown>): string[] {
  const rows = row["tags"];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((entry) => nested(entry as Record<string, unknown>, "tag", "name"))
    .filter((name): name is string => name !== null);
}

export const RULES: Record<TransferType, TypeRules> = {
  service: {
    rules: [
      text("slug"),
      text("name"),
      text("shortDescription"),
      {
        ...text("icon"),
        // Checked here rather than left to the schema so the message names the
        // value and the alternatives. The schema's "Choose an icon from the
        // list" is fine beside a picker and useless beside a spreadsheet cell,
        // where there is no list to choose from.
        read: (raw) => {
          const value = raw.trim();
          if (value === "") return { ok: true, value: "" };
          if (!(ICON_NAMES as readonly string[]).includes(value)) {
            return { ok: false, message: `"${value}" is not an icon. Use one of: ${ICON_NAMES.join(", ")}.` };
          }
          return { ok: true, value };
        },
        current: (row) => str(row, "icon") ?? "",
      },
      status("status", PUBLISHABLE),
      number("order", "keep"),
    ],
    schema: serviceSchema,
    label: (row) => str(row, "name") ?? str(row, "slug") ?? "Service",
    load: (ids) => db.service.findMany({ where: { id: { in: [...ids] } }, select: serviceSelect }),
    all: () => db.service.findMany({ orderBy: { order: "asc" }, select: serviceSelect }),
    findNatural: async (value) =>
      (await db.service.findUnique({ where: { slug: value }, select: { id: true } }))?.id ?? null,
    create: (actor, input) => services.createService(actor, input as ServiceInput),
    update: (actor, id, input) => services.updateService(actor, id, input as ServiceInput),
  },

  city: {
    rules: [
      text("slug"),
      text("name"),
      text("state"),
      text("country"),
      number("latitude", "clear"),
      number("longitude", "clear"),
      number("population", "clear"),
      boolean("isActive"),
      number("order", "keep"),
    ],
    schema: citySchema,
    label: (row) => str(row, "name") ?? str(row, "slug") ?? "City",
    load: (ids) => db.city.findMany({ where: { id: { in: [...ids] } }, select: citySelect }),
    all: () => db.city.findMany({ orderBy: { order: "asc" }, select: citySelect }),
    findNatural: async (value) =>
      (await db.city.findUnique({ where: { slug: value }, select: { id: true } }))?.id ?? null,
    create: (actor, input) => cities.createCity(actor, input as CityInput),
    update: (actor, id, input) => cities.updateCity(actor, id, input as CityInput),
  },

  blogPost: {
    rules: [
      text("slug"),
      text("title"),
      text("excerpt"),
      ref("author", "authorId", (refs) => refs.authors, "staff member with that email", (row) =>
        nested(row, "author", "email"),
      ),
      ref("category", "categoryId", (refs) => refs.categories, "blog category", (row) =>
        nested(row, "category", "slug"),
      ),
      {
        column: "tags",
        field: "tags",
        blank: "clear",
        read: (raw) => ({ ok: true, value: readList(raw) }),
        current: (row) => tagNames(row),
        write: (row) => writeList(tagNames(row)),
      },
      status("status", PUBLISHABLE),
    ],
    schema: blogPostSchema,
    label: (row) => str(row, "title") ?? str(row, "slug") ?? "Post",
    load: (ids) => db.blogPost.findMany({ where: { id: { in: [...ids] } }, select: postSelect }),
    all: () => db.blogPost.findMany({ orderBy: { createdAt: "desc" }, select: postSelect }),
    findNatural: async (value) =>
      (await db.blogPost.findUnique({ where: { slug: value }, select: { id: true } }))?.id ?? null,
    create: (actor, input) => blog.createPost(actor, input as BlogPostInput),
    update: (actor, id, input) => blog.updatePost(actor, id, input as BlogPostInput),
  },

  testimonial: {
    rules: [
      text("authorName"),
      text("authorRole"),
      text("company"),
      text("quote"),
      {
        ...number("rating", "clear"),
        // The schema takes "" for "no rating", not null, and a rating of zero
        // is not a thing anybody means.
        read: (raw) => {
          const parsed = readNumber(raw);
          if (!parsed.ok) return parsed;
          return { ok: true, value: parsed.value === null ? "" : parsed.value };
        },
        current: (row) => num(row, "rating") ?? "",
      },
      ref("service", "serviceId", (refs) => refs.services, "service", (row) =>
        nested(row, "service", "slug"),
      ),
      ref("city", "cityId", (refs) => refs.cities, "city", (row) => nested(row, "city", "slug")),
      status("status", PUBLISHABLE),
      number("order", "keep"),
    ],
    schema: testimonialSchema,
    label: (row) => str(row, "authorName") ?? "Testimonial",
    load: (ids) =>
      db.testimonial.findMany({ where: { id: { in: [...ids] } }, select: testimonialSelect }),
    all: () => db.testimonial.findMany({ orderBy: { order: "asc" }, select: testimonialSelect }),
    findNatural: null,
    create: (actor, input) => testimonials.createTestimonial(actor, input as TestimonialInput),
    update: (actor, id, input) => testimonials.updateTestimonial(actor, id, input as TestimonialInput),
  },

  faq: {
    rules: [
      text("question"),
      text("answer"),
      ref("service", "serviceId", (refs) => refs.services, "service", (row) =>
        nested(row, "service", "slug"),
      ),
      ref("city", "cityId", (refs) => refs.cities, "city", (row) => nested(row, "city", "slug")),
      ref("package", "packageId", (refs) => refs.packages, "package", (row) =>
        nested(row, "package", "slug"),
      ),
      boolean("isActive"),
      number("order", "keep"),
    ],
    schema: faqSchema,
    label: (row) => str(row, "question") ?? "FAQ",
    load: (ids) => db.fAQ.findMany({ where: { id: { in: [...ids] } }, select: faqSelect }),
    all: () => db.fAQ.findMany({ orderBy: { order: "asc" }, select: faqSelect }),
    findNatural: null,
    create: (actor, input) => faqs.createFaq(actor, input as FaqInput),
    update: (actor, id, input) => faqs.updateFaq(actor, id, input as FaqInput),
  },
};
