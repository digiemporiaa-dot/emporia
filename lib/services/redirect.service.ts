import "server-only";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import type { RedirectType } from "@/generated/prisma/enums";

/**
 * Redirect management.
 *
 * Loop detection runs at **write** time, not request time: a cycle is rejected
 * before it can reach production data, so serving a redirect never needs to
 * walk a chain (CLAUDE.md 9, docs/ARCHITECTURE.md 12.4).
 */

const MAX_HOPS = 10;

/** The status an admin selected. Stored intent, not necessarily what is sent. */
export const STATUS_BY_TYPE: Record<RedirectType, 301 | 302 | 307 | 308> = {
  PERMANENT_301: 301,
  FOUND_302: 302,
  TEMPORARY_307: 307,
  PERMANENT_308: 308,
};

/**
 * Whether a redirect type is permanent.
 *
 * Next's `redirect()` and `permanentRedirect()` emit **307 and 308** and cannot
 * be made to emit 301 or 302 — they are the method-preserving equivalents. So a
 * redirect stored as PERMANENT_301 is served as 308, and FOUND_302 as 307.
 *
 * That is a behavioural difference from the stored value, not a functional one:
 * search engines treat 301/308 identically (permanent, signals pass) and
 * 302/307 identically (temporary). Serving an exact 301 would mean resolving
 * redirects in middleware, which cannot reach Prisma on the edge runtime — see
 * docs/ARCHITECTURE.md 12.4. Any admin UI should therefore present this choice
 * as permanent vs temporary rather than as four separate status codes.
 */
export function isPermanent(type: RedirectType): boolean {
  return type === "PERMANENT_301" || type === "PERMANENT_308";
}

/** Normalise a path for comparison: leading slash, no trailing slash, no query. */
export function normalisePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "/";

  // An absolute URL target is left alone — it leaves the site.
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutQuery = withSlash.split(/[?#]/)[0] ?? withSlash;
  return withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : "/";
}

export function isExternal(path: string): boolean {
  return /^https?:\/\//i.test(path.trim());
}

export type RedirectInput = {
  fromPath: string;
  toPath: string;
  type?: RedirectType;
  isActive?: boolean;
};

/**
 * Walk the chain that would exist if this redirect were saved, and reject a
 * cycle or an over-long chain.
 *
 * `excludeId` lets an update ignore its own current row, so editing a redirect
 * is not blocked by the version it is replacing.
 */
export async function assertNoLoop(input: RedirectInput, excludeId?: string): Promise<void> {
  const from = normalisePath(input.fromPath);
  const to = normalisePath(input.toPath);

  if (from === to) {
    throw new ValidationError("A redirect cannot point at itself.");
  }

  if (isExternal(to)) return; // Leaves the site; nothing further to walk.

  const seen = new Set<string>([from]);
  let current = to;

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    if (seen.has(current)) {
      throw new ValidationError(
        `That would create a redirect loop: ${[...seen, current].join(" → ")}`,
      );
    }
    seen.add(current);

    const next = await db.redirect.findFirst({
      where: {
        fromPath: current,
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { toPath: true },
    });

    if (!next) return; // Chain terminates at a real page.

    const nextPath = normalisePath(next.toPath);
    if (isExternal(nextPath)) return;
    current = nextPath;
  }

  throw new ValidationError(
    `That redirect chain is longer than ${MAX_HOPS} hops. Point it at the final destination instead.`,
  );
}

export async function createRedirect(input: RedirectInput) {
  const fromPath = normalisePath(input.fromPath);
  const toPath = normalisePath(input.toPath);

  if (!isExternal(toPath) && !toPath.startsWith("/")) {
    throw new ValidationError("The destination must be a site path or a full URL.");
  }

  const existing = await db.redirect.findUnique({ where: { fromPath }, select: { id: true } });
  if (existing) {
    throw new ConflictError("A redirect already exists for that path.");
  }

  await assertNoLoop({ ...input, fromPath, toPath });

  return db.redirect.create({
    data: {
      fromPath,
      toPath,
      type: input.type ?? "PERMANENT_301",
      isActive: input.isActive ?? true,
    },
  });
}

export async function updateRedirect(id: string, input: RedirectInput) {
  const fromPath = normalisePath(input.fromPath);
  const toPath = normalisePath(input.toPath);

  const clash = await db.redirect.findFirst({
    where: { fromPath, id: { not: id } },
    select: { id: true },
  });
  if (clash) throw new ConflictError("Another redirect already uses that path.");

  await assertNoLoop({ ...input, fromPath, toPath }, id);

  return db.redirect.update({
    where: { id },
    data: {
      fromPath,
      toPath,
      type: input.type ?? "PERMANENT_301",
      isActive: input.isActive ?? true,
    },
  });
}

export type ResolvedRedirect = {
  toPath: string;
  /** The status the admin chose. */
  intendedStatus: 301 | 302 | 307 | 308;
  /** What is actually sent: 308 for permanent, 307 for temporary. */
  servedStatus: 307 | 308;
  permanent: boolean;
};

/**
 * Look up an active redirect for a path. Called from the catch-all route, so it
 * only runs for URLs that matched no real page.
 */
export async function resolveRedirect(path: string): Promise<ResolvedRedirect | null> {
  const fromPath = normalisePath(path);

  const redirect = await db.redirect.findFirst({
    where: { fromPath, isActive: true },
    select: { id: true, toPath: true, type: true },
  });

  if (!redirect) return null;

  // Best-effort hit counting; a failure here must not break the redirect.
  void db.redirect
    .update({
      where: { id: redirect.id },
      data: { hits: { increment: 1 }, lastHitAt: new Date() },
    })
    .catch(() => undefined);

  const permanent = isPermanent(redirect.type);

  return {
    toPath: redirect.toPath,
    intendedStatus: STATUS_BY_TYPE[redirect.type],
    servedStatus: permanent ? 308 : 307,
    permanent,
  };
}
