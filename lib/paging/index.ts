import { z } from "zod";

/**
 * Server-side paging.
 *
 * CLAUDE.md 12 forbids loading a full table into the browser, and an admin list
 * that renders every row is exactly that once the agency has a few years of
 * proposals behind it. This is the one place the bounds are defined, so no list
 * can pick its own — or forget to have any.
 */

export const DEFAULT_PER_PAGE = 25;
const MIN_PER_PAGE = 5;
const MAX_PER_PAGE = 100;

export const pageParamsSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  perPage: z.coerce.number().int().min(MIN_PER_PAGE).max(MAX_PER_PAGE).default(DEFAULT_PER_PAGE),
});

export type PageParams = z.infer<typeof pageParamsSchema>;

/** `skip`/`take` for Prisma, with the bounds applied rather than trusted. */
export function toSkipTake(params: Partial<PageParams>): {
  page: number;
  perPage: number;
  skip: number;
  take: number;
} {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(MAX_PER_PAGE, Math.max(MIN_PER_PAGE, params.perPage ?? DEFAULT_PER_PAGE));
  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

export type Paged<T> = {
  rows: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
};

/** Assemble the paged envelope every list returns. */
export function paged<T>(rows: T[], total: number, page: number, perPage: number): Paged<T> {
  return { rows, total, page, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
}
