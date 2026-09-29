import "server-only";
import { db } from "@/lib/db";
import { periodSummary } from "@/lib/services/social-summary.service";
import { CALENDAR_TIME_ZONE, startOfZonedDay, zonedDay } from "@/lib/social/calendar";
import { SNAPSHOT_SELECT, engagementOf, isMeasured, toReportRow } from "@/lib/social/report";
import { engagementRate } from "@/lib/social/insights";
import type { Prisma } from "@/generated/prisma/client";
import type { PortalActor } from "@/lib/actor/types";

/**
 * The client's own social section in the portal (brief §16).
 *
 * Every function takes the portal actor and scopes by `actor.clientId` — the
 * session's client, never a value from the browser. What a client sees is
 * limited to work that has been put in front of them: anything at client
 * review or later. Ideas, drafts and internal review stay on the agency's
 * side, and nothing here exposes an account id, a token, or an internal note.
 */

/** Stages a client may see — the same rule as the portal's content list. */
const CLIENT_STAGES = ["CLIENT_REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED"] as const;

const monthBounds = (year: number, month: number) => ({
  from: startOfZonedDay({ year, month, day: 1 }, CALENDAR_TIME_ZONE),
  to: startOfZonedDay(month === 12 ? { year: year + 1, month: 1, day: 1 } : { year, month: month + 1, day: 1 }, CALENDAR_TIME_ZONE),
});

/** A client-facing word for where a post is — nothing about internal steps. */
export type ClientPostState = "IN_REVIEW" | "APPROVED" | "SCHEDULED" | "PUBLISHED" | "DELAYED";

function stateOf(stage: string, status: string): ClientPostState {
  if (status === "PUBLISHED") return "PUBLISHED";
  // A failed attempt is the agency's to fix; the client is told it is delayed,
  // not shown an error from a platform.
  if (status === "FAILED" || status === "PUBLISHING") return "DELAYED";
  if (status === "SCHEDULED") return "SCHEDULED";
  return stage === "CLIENT_REVIEW" ? "IN_REVIEW" : "APPROVED";
}

const versionSelect = {
  id: true,
  provider: true,
  type: true,
  status: true,
  scheduledFor: true,
  publishedAt: true,
  externalUrl: true,
  contentItem: { select: { id: true, title: true, stage: true, scheduledFor: true, campaign: { select: { name: true } } } },
  media: { orderBy: { order: "asc" }, take: 1, select: { media: { select: { url: true, alt: true, type: true } } } },
} satisfies Prisma.SocialPostSelect;

type VersionRow = Prisma.SocialPostGetPayload<{ select: typeof versionSelect }>;

function toCard(post: VersionRow) {
  const at = post.publishedAt ?? post.scheduledFor ?? post.contentItem.scheduledFor;
  return {
    id: post.id,
    title: post.contentItem.title,
    campaign: post.contentItem.campaign?.name ?? null,
    provider: post.provider,
    type: post.type,
    state: stateOf(post.contentItem.stage, post.status),
    at: at?.toISOString() ?? null,
    externalUrl: post.status === "PUBLISHED" ? post.externalUrl : null,
    thumbnail: post.media[0]?.media.type === "IMAGE" ? { url: post.media[0].media.url, alt: post.media[0].media.alt } : null,
  };
}

export type ClientPostCard = ReturnType<typeof toCard>;

const clientVisible = (actor: PortalActor): Prisma.SocialPostWhereInput => ({
  clientId: actor.clientId,
  status: { not: "CANCELLED" },
  contentItem: { stage: { in: [...CLIENT_STAGES] } },
});

/** The month at a glance: figures, what needs them, what is coming up. */
export async function portalSocialOverview(actor: PortalActor, now = new Date()) {
  const today = zonedDay(now, CALENDAR_TIME_ZONE);
  const { from, to } = monthBounds(today.year, today.month);

  const [month, pending, upcoming, report] = await Promise.all([
    periodSummary(actor.clientId, from, to),
    db.approval.count({ where: { clientId: actor.clientId, status: "PENDING", contentItem: { socialPosts: { some: {} } } } }),
    db.socialPost.findMany({
      where: { ...clientVisible(actor), status: "SCHEDULED", scheduledFor: { gte: now } },
      orderBy: { scheduledFor: "asc" },
      take: 5,
      select: versionSelect,
    }),
    db.socialReport.findFirst({
      where: { clientId: actor.clientId, status: "PUBLISHED" },
      orderBy: { month: "desc" },
      select: { id: true, month: true },
    }),
  ]);

  return {
    monthLabel: new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: CALENDAR_TIME_ZONE }).format(from),
    month: {
      posts: month.posts,
      measured: month.measured,
      reach: month.totals.reach,
      impressions: month.totals.impressions,
      engagement: month.totals.engagement,
      followersGained: month.totals.followersGained,
      rate: month.rate,
    },
    pendingApprovals: pending,
    upcoming: upcoming.map(toCard),
    latestReport: report,
  };
}

/** One month of the client's visible posts, by day, in India time. */
export async function portalSocialCalendar(actor: PortalActor, month: { year: number; month: number }) {
  const { from, to } = monthBounds(month.year, month.month);
  const posts = await db.socialPost.findMany({
    where: {
      ...clientVisible(actor),
      OR: [
        { publishedAt: { gte: from, lt: to } },
        { publishedAt: null, scheduledFor: { gte: from, lt: to } },
        { publishedAt: null, scheduledFor: null, contentItem: { scheduledFor: { gte: from, lt: to } } },
      ],
    },
    take: 500,
    select: versionSelect,
  });
  return posts
    .map(toCard)
    .filter((card) => card.at !== null)
    .sort((a, b) => a.at!.localeCompare(b.at!));
}

/** Social work waiting on the client, and what they decided lately. */
export async function portalSocialApprovals(actor: PortalActor, now = new Date()) {
  const select = {
    id: true,
    status: true,
    currentVersion: true,
    decidedAt: true,
    updatedAt: true,
    contentItem: { select: { title: true, socialPosts: { select: { provider: true } } } },
  } satisfies Prisma.ApprovalSelect;
  const social = { clientId: actor.clientId, contentItem: { socialPosts: { some: {} } } } satisfies Prisma.ApprovalWhereInput;
  const [pending, decided] = await Promise.all([
    db.approval.findMany({ where: { ...social, status: "PENDING" }, orderBy: { updatedAt: "asc" }, take: 100, select }),
    db.approval.findMany({
      where: { ...social, status: { in: ["APPROVED", "CHANGES_REQUESTED"] }, decidedAt: { gte: new Date(now.getTime() - 60 * 86_400_000) } },
      orderBy: { decidedAt: "desc" },
      take: 50,
      select,
    }),
  ]);
  return { pending, decided };
}

export const PORTAL_PUBLISHED_PAGE = 20;

/** Published posts, newest first, a page at a time, with what each did. */
export async function portalPublished(actor: PortalActor, page: number) {
  const where: Prisma.SocialPostWhereInput = { clientId: actor.clientId, status: "PUBLISHED" };
  const current = Math.max(1, page);
  const [total, posts] = await Promise.all([
    db.socialPost.count({ where }),
    db.socialPost.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      skip: (current - 1) * PORTAL_PUBLISHED_PAGE,
      take: PORTAL_PUBLISHED_PAGE,
      select: { ...versionSelect, metrics: { orderBy: { capturedOn: "desc" }, take: 1, select: SNAPSHOT_SELECT } },
    }),
  ]);
  return {
    total,
    page: current,
    pages: Math.max(1, Math.ceil(total / PORTAL_PUBLISHED_PAGE)),
    posts: posts.map((post) => {
      const row = toReportRow(post);
      return {
        ...toCard(post),
        reach: row.reach,
        engagement: isMeasured(row) ? engagementOf(row) : null,
        rate: engagementRate(row),
      };
    }),
  };
}
