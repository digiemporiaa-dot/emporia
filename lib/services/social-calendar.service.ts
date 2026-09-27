import "server-only";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { resolveClientScope } from "@/lib/social/scope";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ContentStage,
  SocialPostStatus,
  SocialPostType,
  SocialProvider,
} from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";

/**
 * The calendar's read model.
 *
 * The calendar is over **platform versions**, not over ideas. An idea called
 * "Diwali launch" is one row in the content list but three cards on the
 * calendar — Instagram at 7:30pm, LinkedIn at 10am the next morning, X at
 * noon — because those are three separate things that go out at three separate
 * times, and a calendar that collapses them tells a scheduler nothing.
 *
 * ## When a post actually goes out
 *
 * A version may carry its own `scheduledFor`, or leave it unset and inherit the
 * idea's target date. That fallback is the whole reason this service exists
 * rather than a `findMany` in the page: it has to hold in the **query** as well
 * as in the result, or a version that inherits its date silently vanishes from
 * the month it belongs to. Hence the OR below, and `effectiveAt` on every row.
 *
 * ## Isolation
 *
 * Every read goes through `resolveClientScope`, so a portal user gets their own
 * client from the session and a request naming another client is refused
 * rather than quietly narrowed.
 */

const calendarSelect = {
  id: true,
  clientId: true,
  provider: true,
  type: true,
  status: true,
  caption: true,
  scheduledFor: true,
  publishedAt: true,
  externalUrl: true,
  lastError: true,
  account: { select: { id: true, name: true, status: true } },
  media: {
    orderBy: { order: "asc" },
    take: 1,
    select: { media: { select: { id: true, url: true, type: true, alt: true } } },
  },
  contentItem: {
    select: {
      id: true,
      title: true,
      stage: true,
      scheduledFor: true,
      owner: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      project: { select: { id: true, name: true, code: true } },
    },
  },
} satisfies Prisma.SocialPostSelect;

type CalendarPost = Prisma.SocialPostGetPayload<{ select: typeof calendarSelect }>;

/** What a calendar card renders. Flat, and serialisable across to the client. */
export type CalendarCard = {
  id: string;
  itemId: string;
  title: string;
  provider: SocialProvider;
  type: SocialPostType;
  status: SocialPostStatus;
  stage: ContentStage;
  /** When this version goes out, after the fallback to the idea's date. */
  effectiveAt: string | null;
  /** True when the date came from the idea rather than the version itself. */
  inherited: boolean;
  publishedAt: string | null;
  externalUrl: string | null;
  failed: boolean;
  accountName: string | null;
  campaign: { id: string; name: string } | null;
  project: { id: string; name: string; code: string } | null;
  owner: { id: string; name: string } | null;
  thumbnail: { url: string; alt: string | null } | null;
  excerpt: string | null;
};

export type CalendarFilters = {
  clientId: string | null;
  from: Date;
  /** Exclusive. */
  to: Date;
  provider?: SocialProvider | null;
  type?: SocialPostType | null;
  status?: SocialPostStatus | null;
  stage?: ContentStage | null;
  campaignId?: string | null;
  projectId?: string | null;
  ownerId?: string | null;
};

/**
 * A calendar holds a month at a time. The cap is here so a client with a very
 * busy month returns a large page rather than an unbounded one; the count that
 * comes back with it lets the UI say so instead of silently truncating.
 */
const MAX_CARDS = 500;

export async function calendarPosts(
  actor: Actor,
  filters: CalendarFilters,
): Promise<{ cards: CalendarCard[]; truncated: boolean }> {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, filters.clientId);

  const window = { gte: filters.from, lt: filters.to };
  const item = filters.projectId || filters.stage || filters.campaignId || filters.ownerId;

  const rows = await db.socialPost.findMany({
    where: {
      clientId: scope,
      // Its own date, or — when it has none — the idea's. Both arms are
      // needed: dropping the second loses every version that inherits.
      OR: [
        { scheduledFor: window },
        { scheduledFor: null, contentItem: { scheduledFor: window } },
      ],
      ...(filters.provider ? { provider: filters.provider } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(item
        ? {
            contentItem: {
              ...(filters.stage ? { stage: filters.stage } : {}),
              ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
              ...(filters.projectId ? { projectId: filters.projectId } : {}),
              ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ scheduledFor: "asc" }, { order: "asc" }],
    take: MAX_CARDS + 1,
    select: calendarSelect,
  });

  return {
    cards: rows.slice(0, MAX_CARDS).map(toCard),
    truncated: rows.length > MAX_CARDS,
  };
}

function toCard(row: CalendarPost): CalendarCard {
  const inherited = row.scheduledFor === null;
  const effective = row.scheduledFor ?? row.contentItem.scheduledFor;
  const thumbnail = row.media[0]?.media ?? null;

  return {
    id: row.id,
    itemId: row.contentItem.id,
    title: row.contentItem.title,
    provider: row.provider,
    type: row.type,
    status: row.status,
    stage: row.contentItem.stage,
    effectiveAt: effective ? effective.toISOString() : null,
    inherited: inherited && effective !== null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    externalUrl: row.externalUrl,
    failed: row.status === "FAILED" || row.lastError !== null,
    accountName: row.account?.name ?? null,
    campaign: row.contentItem.campaign,
    project: row.contentItem.project,
    owner: row.contentItem.owner,
    // Only images make a useful thumbnail; a video's poster frame is not
    // something we hold yet, so it gets the type badge instead of a broken box.
    thumbnail:
      thumbnail && thumbnail.type === "IMAGE"
        ? { url: thumbnail.url, alt: thumbnail.alt }
        : null,
    excerpt: excerpt(row.caption),
  };
}

function excerpt(caption: string | null): string | null {
  if (!caption) return null;
  const flat = caption.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > 90 ? `${flat.slice(0, 89)}…` : flat;
}

/**
 * Ideas with no date at all.
 *
 * These belong beside the grid rather than in it. A version with no date is
 * not "today" and it is not nowhere — it is work that has been written and
 * never scheduled, which is exactly the queue a planner wants in front of them
 * while they look at an empty Thursday.
 */
export async function unscheduledPosts(
  actor: Actor,
  filters: Omit<CalendarFilters, "from" | "to">,
): Promise<CalendarCard[]> {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, filters.clientId);

  const rows = await db.socialPost.findMany({
    where: {
      clientId: scope,
      scheduledFor: null,
      contentItem: { scheduledFor: null },
      status: filters.status ? filters.status : { in: ["DRAFT", "SCHEDULED"] },
      // The same filters as the grid. A panel that keeps showing Instagram
      // while the calendar above it is filtered to LinkedIn reads as a bug,
      // and the planner cannot tell whether the filter took.
      ...(filters.provider ? { provider: filters.provider } : {}),
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.stage || filters.campaignId || filters.projectId || filters.ownerId
        ? {
            contentItem: {
              scheduledFor: null,
              ...(filters.stage ? { stage: filters.stage } : {}),
              ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
              ...(filters.projectId ? { projectId: filters.projectId } : {}),
              ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
            },
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 25,
    select: calendarSelect,
  });

  return rows.map(toCard);
}
