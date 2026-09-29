import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { resolveClientScope } from "@/lib/social/scope";
import {
  CALENDAR_TIME_ZONE,
  addDays,
  startOfWeek,
  startOfZonedDay,
  zonedDay,
} from "@/lib/social/calendar";
import {
  KPI_METRICS,
  KPI_PERIODS,
  brandProfileSchema,
  pillarSchema,
  strategySchema,
  type BrandProfileInput,
  type KpiMetric,
  type PillarInput,
  type StrategyInput,
} from "@/lib/validation/social-brand";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";

/**
 * A client's brand kit: how it sounds (brand profile), what it talks about
 * (content pillars) and what the agency is aiming at (strategy).
 *
 * Three small records rather than one, because they change at different
 * speeds and for different reasons — a tone is settled once, pillars are
 * revised each quarter, a strategy is renegotiated with the client. All three
 * hang off the client and are reached only through `resolveClientScope`, so
 * the isolation rule is the same as every other social read.
 *
 * Nothing here computes whether a target was met. The strategy stores what
 * was agreed; the only comparison offered (`postingThisWeek`) counts posts
 * that really exist.
 */

const profileSelect = {
  brandName: true,
  tone: true,
  industry: true,
  targetAudience: true,
  preferredLanguage: true,
  ctaStyle: true,
  brandColors: true,
  hashtags: true,
  forbiddenWords: true,
  preferredEmojis: true,
  postingRules: true,
  updatedAt: true,
} as const;

const pillarSelect = {
  id: true,
  name: true,
  description: true,
  position: true,
  archivedAt: true,
  _count: { select: { items: true } },
} as const;

export type KpiTarget = { metric: KpiMetric; target: number; period: (typeof KPI_PERIODS)[number] };

export type StrategyView = {
  objectives: string | null;
  platforms: SocialProvider[];
  postingFrequency: Partial<Record<SocialProvider, number>>;
  campaignGoals: string | null;
  kpiTargets: KpiTarget[];
  updatedAt: Date;
};

/** Stored JSON read back defensively: a malformed row reads as empty, not as a crash. */
function readStrategy(row: {
  objectives: string | null;
  platforms: SocialProvider[];
  postingFrequency: unknown;
  campaignGoals: string | null;
  kpiTargets: unknown;
  updatedAt: Date;
}): StrategyView {
  const frequency: Partial<Record<SocialProvider, number>> = {};
  if (row.postingFrequency && typeof row.postingFrequency === "object") {
    for (const [provider, count] of Object.entries(row.postingFrequency as Record<string, unknown>)) {
      if (row.platforms.includes(provider as SocialProvider) && typeof count === "number" && count > 0) {
        frequency[provider as SocialProvider] = count;
      }
    }
  }
  const targets = Array.isArray(row.kpiTargets)
    ? (row.kpiTargets as unknown[]).filter((t): t is KpiTarget => {
        const k = t as Partial<KpiTarget>;
        return (
          KPI_METRICS.includes(k.metric as KpiMetric) &&
          typeof k.target === "number" &&
          (KPI_PERIODS as readonly string[]).includes(k.period as string)
        );
      })
    : [];
  return {
    objectives: row.objectives,
    platforms: row.platforms,
    postingFrequency: frequency,
    campaignGoals: row.campaignGoals,
    kpiTargets: targets,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function getBrandKit(actor: Actor, clientId: string) {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, clientId);

  const [profile, pillars, strategy] = await Promise.all([
    db.socialBrandProfile.findUnique({ where: { clientId: scope }, select: profileSelect }),
    db.contentPillar.findMany({
      where: { clientId: scope },
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { position: "asc" }, { name: "asc" }],
      select: pillarSelect,
    }),
    db.socialStrategy.findUnique({
      where: { clientId: scope },
      select: {
        objectives: true,
        platforms: true,
        postingFrequency: true,
        campaignGoals: true,
        kpiTargets: true,
        updatedAt: true,
      },
    }),
  ]);

  return { profile, pillars, strategy: strategy ? readStrategy(strategy) : null };
}

/** The strategy's planned posts per week, per platform — empty when there is no strategy. */
export async function plannedFrequency(actor: Actor, clientId: string): Promise<Partial<Record<SocialProvider, number>>> {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, clientId);
  const strategy = await db.socialStrategy.findUnique({
    where: { clientId: scope },
    select: { platforms: true, postingFrequency: true, objectives: true, campaignGoals: true, kpiTargets: true, updatedAt: true },
  });
  return strategy ? readStrategy(strategy).postingFrequency : {};
}

/** Pillars a new or edited content item may be filed under. */
export async function activePillars(actor: Actor, clientId: string) {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, clientId);
  return db.contentPillar.findMany({
    where: { clientId: scope, archivedAt: null },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

/**
 * The pillar a content item is being filed under, proven to be the client's.
 *
 * The same rule campaigns follow: an id from the form is only a suggestion
 * until it is found under the client the item belongs to. An archived pillar
 * is refused for new filing but kept on items that already had it.
 */
export async function assertPillarForClient(
  pillarId: string | null | undefined,
  clientId: string,
  currentPillarId: string | null = null,
): Promise<void> {
  if (!pillarId) return;
  const pillar = await db.contentPillar.findFirst({
    where: { id: pillarId, clientId },
    select: { id: true, archivedAt: true },
  });
  if (!pillar) throw new ValidationError("That content pillar does not belong to this client.");
  if (pillar.archivedAt && pillar.id !== currentPillarId) {
    throw new ValidationError("That content pillar is archived. Restore it first, or choose another.");
  }
}

/**
 * The brand kit, compacted for a prompt. Server-side only and called after
 * the caller has already resolved the client's scope; returns nothing the
 * client did not write themselves.
 */
export async function brandKitForPrompt(clientId: string, pillarId: string | null) {
  const [profile, pillar] = await Promise.all([
    db.socialBrandProfile.findUnique({ where: { clientId }, select: profileSelect }),
    pillarId
      ? db.contentPillar.findFirst({ where: { id: pillarId, clientId }, select: { name: true, description: true } })
      : null,
  ]);
  return { profile, pillar };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function saveBrandProfile(actor: Actor, clientId: string, input: BrandProfileInput) {
  requirePermission(actor, "social.edit");
  const scope = await resolveClientScope(actor, clientId);
  const data = brandProfileSchema.parse(input);

  const before = await db.socialBrandProfile.findUnique({ where: { clientId: scope }, select: profileSelect });
  const updatedById = actor.type === "STAFF" ? actor.userId : null;

  return withAudit(
    {
      actor,
      action: before ? "UPDATE" : "CREATE",
      entityType: "SocialBrandProfile",
      entityId: scope,
      before,
      after: data,
    },
    (tx) =>
      tx.socialBrandProfile.upsert({
        where: { clientId: scope },
        create: { clientId: scope, ...data, updatedById },
        update: { ...data, updatedById },
        select: profileSelect,
      }),
  );
}

export async function createPillar(actor: Actor, clientId: string, input: PillarInput) {
  requirePermission(actor, "social.edit");
  const scope = await resolveClientScope(actor, clientId);
  const data = pillarSchema.parse(input);

  await assertNameFree(scope, data.name, null);
  const last = await db.contentPillar.findFirst({
    where: { clientId: scope },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  return withAudit(
    { actor, action: "CREATE", entityType: "ContentPillar", entityId: data.name, after: { clientId: scope, ...data } },
    (tx) =>
      tx.contentPillar.create({
        data: { clientId: scope, ...data, position: (last?.position ?? -1) + 1 },
        select: pillarSelect,
      }),
  );
}

export async function updatePillar(actor: Actor, id: string, input: PillarInput) {
  requirePermission(actor, "social.edit");
  const pillar = await pillarInScope(actor, id);
  const data = pillarSchema.parse(input);
  await assertNameFree(pillar.clientId, data.name, id);

  return withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "ContentPillar",
      entityId: id,
      before: { name: pillar.name, description: pillar.description },
      after: data,
    },
    (tx) => tx.contentPillar.update({ where: { id }, data, select: pillarSelect }),
  );
}

/**
 * Archive or restore. Archiving rather than deleting keeps the history of
 * what content served which pillar; an archived pillar simply stops being
 * offered for new work.
 */
export async function setPillarArchived(actor: Actor, id: string, archived: boolean) {
  requirePermission(actor, "social.edit");
  const pillar = await pillarInScope(actor, id);

  return withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "ContentPillar",
      entityId: id,
      before: { archived: pillar.archivedAt !== null },
      after: { archived },
    },
    (tx) =>
      tx.contentPillar.update({
        where: { id },
        data: { archivedAt: archived ? new Date() : null },
        select: pillarSelect,
      }),
  );
}

/** Swap a pillar with its neighbour, so order is changed one step at a time. */
export async function movePillar(actor: Actor, id: string, direction: "up" | "down") {
  requirePermission(actor, "social.edit");
  const pillar = await pillarInScope(actor, id);

  const siblings = await db.contentPillar.findMany({
    where: { clientId: pillar.clientId, archivedAt: null },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  const at = siblings.findIndex((s) => s.id === id);
  const to = direction === "up" ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= siblings.length) return;

  // Rewrite positions densely: two pillars that shared a position (from an
  // older edit) would otherwise swap to the same place and not move.
  const order = siblings.map((s) => s.id);
  [order[at], order[to]] = [order[to]!, order[at]!];

  await withAudit(
    { actor, action: "UPDATE", entityType: "ContentPillar", entityId: id, after: { moved: direction } },
    async (tx) => {
      for (const [position, pillarId] of order.entries()) {
        await tx.contentPillar.update({ where: { id: pillarId }, data: { position } });
      }
    },
  );
}

export async function saveStrategy(actor: Actor, clientId: string, input: StrategyInput) {
  requirePermission(actor, "social.edit");
  const scope = await resolveClientScope(actor, clientId);
  const data = strategySchema.parse(input);

  const before = await db.socialStrategy.findUnique({
    where: { clientId: scope },
    select: { objectives: true, platforms: true, postingFrequency: true, campaignGoals: true, kpiTargets: true },
  });
  const updatedById = actor.type === "STAFF" ? actor.userId : null;

  const row = await withAudit(
    {
      actor,
      action: before ? "UPDATE" : "CREATE",
      entityType: "SocialStrategy",
      entityId: scope,
      before,
      after: data,
    },
    (tx) =>
      tx.socialStrategy.upsert({
        where: { clientId: scope },
        create: { clientId: scope, ...data, updatedById },
        update: { ...data, updatedById },
        select: {
          objectives: true,
          platforms: true,
          postingFrequency: true,
          campaignGoals: true,
          kpiTargets: true,
          updatedAt: true,
        },
      }),
  );
  return readStrategy(row);
}

// ---------------------------------------------------------------------------
// The one comparison: planned against real
// ---------------------------------------------------------------------------

export type PostingWeek = {
  from: Date;
  to: Date;
  rows: { provider: SocialProvider; planned: number; scheduled: number; published: number }[];
};

/**
 * This week's posts per platform against the strategy's planned frequency.
 *
 * Counts, not judgements: how many versions are scheduled or published for
 * the week, beside how many were planned. The week runs Monday to Sunday in
 * the calendar's time zone, so it agrees with the calendar a planner is
 * looking at.
 */
export async function postingThisWeek(actor: Actor, clientId: string, now = new Date()): Promise<PostingWeek | null> {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, clientId);

  const strategy = await db.socialStrategy.findUnique({
    where: { clientId: scope },
    select: { platforms: true, postingFrequency: true, objectives: true, campaignGoals: true, kpiTargets: true, updatedAt: true },
  });
  if (!strategy) return null;
  const planned = readStrategy(strategy).postingFrequency;
  const providers = Object.keys(planned) as SocialProvider[];
  if (providers.length === 0) return null;

  const monday = startOfWeek(zonedDay(now, CALENDAR_TIME_ZONE));
  const from = startOfZonedDay(monday, CALENDAR_TIME_ZONE);
  const to = startOfZonedDay(addDays(monday, 7), CALENDAR_TIME_ZONE);

  const posts = await db.socialPost.findMany({
    where: {
      clientId: scope,
      provider: { in: providers },
      status: { in: ["SCHEDULED", "PUBLISHING", "PUBLISHED"] },
      OR: [
        { scheduledFor: { gte: from, lt: to } },
        { publishedAt: { gte: from, lt: to } },
      ],
    },
    select: { provider: true, status: true },
  });

  return {
    from,
    to,
    rows: providers.map((provider) => ({
      provider,
      planned: planned[provider] ?? 0,
      scheduled: posts.filter((p) => p.provider === provider && p.status !== "PUBLISHED").length,
      published: posts.filter((p) => p.provider === provider && p.status === "PUBLISHED").length,
    })),
  };
}

// ---------------------------------------------------------------------------

async function pillarInScope(actor: Actor, id: string) {
  const pillar = await db.contentPillar.findUnique({
    where: { id },
    select: { id: true, clientId: true, name: true, description: true, archivedAt: true },
  });
  if (!pillar) throw new NotFoundError("That content pillar does not exist.");
  await resolveClientScope(actor, pillar.clientId);
  return pillar;
}

async function assertNameFree(clientId: string, name: string, exceptId: string | null) {
  const clash = await db.contentPillar.findFirst({
    where: { clientId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ConflictError(`This client already has a pillar called "${name}".`);
}
