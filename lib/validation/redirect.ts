import { z } from "zod";

/**
 * Redirect input.
 *
 * The type is offered as **permanent or temporary**, not as four status codes.
 * Next's `redirect()` and `permanentRedirect()` emit 307 and 308 and cannot be
 * made to emit 301 or 302, so presenting four choices would let an admin pick
 * one and be served another — see `redirect.service.ts`.
 */

const path = z
  .string()
  .trim()
  .min(1, "Enter a path.")
  .max(500)
  .refine(
    (value) => value.startsWith("/") || /^https?:\/\//i.test(value),
    "Enter a path starting with / or a full URL.",
  );

export const redirectSchema = z.object({
  fromPath: z
    .string()
    .trim()
    .min(1, "Enter the old path.")
    .max(500)
    .refine(
      (value) => !/^https?:\/\//i.test(value),
      "The old address must be a path on this site, not a full URL.",
    ),
  toPath: path,
  permanent: z.union([z.literal("on"), z.literal(""), z.boolean()]).transform((value) =>
    value === "on" || value === true,
  ),
  isActive: z.union([z.literal("on"), z.literal(""), z.boolean()]).transform((value) =>
    value === "on" || value === true,
  ),
});

export type RedirectFormInput = z.infer<typeof redirectSchema>;

export const redirectListSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(10).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  active: z.enum(["all", "on", "off"]).default("all"),
});

export type RedirectListInput = z.infer<typeof redirectListSchema>;
