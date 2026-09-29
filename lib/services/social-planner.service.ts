import "server-only";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { resolveClientScope } from "@/lib/social/scope";
import { CAPABILITIES, PROVIDER_LABEL } from "@/lib/social/capabilities";
import { CALENDAR_TIME_ZONE, startOfZonedDay } from "@/lib/social/calendar";
import { createSocialContent } from "@/lib/services/social-content.service";
import { savePost } from "@/lib/services/social-post.service";
import { occasionsBetween } from "@/lib/services/social-occasion.service";
import { PLAN_MAX_POSTS } from "@/lib/services/ai.service";
import { socialPostSchema } from "@/lib/validation/social";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";

/**
 * Turn a reviewed month plan into draft content.
 *
 * The person has read the plan and unticked what they do not want; what
 * arrives is what they kept. Each item becomes an ordinary idea at DRAFT,
 * dated to its day at `PLANNED_HOUR` in the calendar's time zone, with an
 * empty platform version per planned platform — the shape of the month, with
 * the writing still to do. Those versions are marked as AI drafts, so none of
 * them can go to the client until a person has written and saved it.
 *
 * Everything is checked before anything is written, and a failure part-way
 * removes what this call created: half a month is worse than none.
 */

/** When a planned idea is dated on its day, before anyone picks a time. */
const PLANNED_HOUR = 10;

export type PlannedItemInput = {
  day: string;
  title: string;
  brief: string | null;
  pillarId: string | null;
  campaignId: string | null;
  occasionId: string | null;
  versions: { provider: SocialProvider; type: string }[];
};

export async function createPlannedContent(
  actor: Actor,
  input: { clientId: string; projectId: string; month: string; items: PlannedItemInput[] },
): Promise<{ created: number }> {
  requirePermission(actor, "social.create");
  const scope = await resolveClientScope(actor, input.clientId);

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new ValidationError("Choose a month.");
  const [year, monthNumber] = input.month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const firstDay = `${input.month}-01`;
  const lastDay = `${input.month}-${String(daysInMonth).padStart(2, "0")}`;

  if (input.items.length === 0) throw new ValidationError("Keep at least one item from the plan.");
  const posts = input.items.reduce((sum, item) => sum + item.versions.length, 0);
  if (posts > PLAN_MAX_POSTS) throw new ValidationError(`At most ${PLAN_MAX_POSTS} posts in one plan.`);

  // An occasion named on an item must be one this client really has, on that
  // item's day — not an id from the browser pointing anywhere.
  const occasions = await occasionsBetween(actor, scope, firstDay, lastDay);

  for (const item of input.items) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.day) || item.day < firstDay || item.day > lastDay) {
      throw new ValidationError(`"${item.title}" is dated outside ${input.month}.`);
    }
    if (item.versions.length === 0) throw new ValidationError(`"${item.title}" has no platforms.`);
    if (new Set(item.versions.map((v) => v.provider)).size !== item.versions.length) {
      throw new ValidationError(`"${item.title}" lists a platform twice.`);
    }
    for (const version of item.versions) {
      if (!(CAPABILITIES[version.provider]?.postTypes as readonly string[] | undefined)?.includes(version.type)) {
        throw new ValidationError(`${PROVIDER_LABEL[version.provider] ?? version.provider} cannot publish that format.`);
      }
    }
    if (item.occasionId && !occasions.some((o) => o.occasionId === item.occasionId && o.day === item.day)) {
      throw new ValidationError(`"${item.title}" names an occasion this client does not have on that day.`);
    }
  }

  const created: string[] = [];
  try {
    for (const item of input.items) {
      const [y, m, d] = item.day.split("-").map(Number) as [number, number, number];
      const scheduledFor = new Date(
        startOfZonedDay({ year: y, month: m, day: d }, CALENDAR_TIME_ZONE).getTime() + PLANNED_HOUR * 3_600_000,
      );
      const occasion = item.occasionId ? occasions.find((o) => o.occasionId === item.occasionId) : null;
      const brief = [occasion ? `Occasion: ${occasion.name}.` : "", item.brief ?? ""].filter(Boolean).join("\n\n") || null;

      // Project, campaign and pillar are proven to be this client's here.
      const idea = await createSocialContent(actor, {
        clientId: scope,
        projectId: input.projectId,
        title: item.title,
        brief,
        campaignId: item.campaignId,
        pillarId: item.pillarId,
        ownerId: null,
        scheduledFor,
      });
      created.push(idea.id);

      const versionIds: string[] = [];
      for (const version of item.versions) {
        const post = await savePost(
          actor,
          null,
          socialPostSchema.parse({ contentItemId: idea.id, provider: version.provider, type: version.type }),
        );
        versionIds.push(post.id);
      }
      // Empty until someone writes them, and not sendable until someone saves them.
      await db.socialPost.updateMany({ where: { id: { in: versionIds } }, data: { aiDraftedAt: new Date() } });
    }
  } catch (error) {
    await db.contentCalendarItem.deleteMany({ where: { id: { in: created } } }).catch(() => undefined);
    throw error;
  }

  return { created: created.length };
}
