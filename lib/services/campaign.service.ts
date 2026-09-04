import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { toMoneyString } from "@/lib/money";
import { rangeFilter, type DateRange } from "@/lib/analytics/range";
import { campaignMetricSchema } from "@/lib/validation/marketing";
import type { CampaignInput, CampaignListParams } from "@/lib/validation/marketing";
import type { Actor } from "@/lib/actor/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Campaigns and their performance data.
 *
 * A metric row is only ever written from a person typing it or importing a
 * file they exported from the platform themselves. Nothing in this module
 * estimates, models or back-fills a number — a campaign with no data reports
 * no data (CLAUDE.md 2 rule 5, 16).
 */

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function listCampaigns(actor: Actor, params: CampaignListParams = {}) {
  requirePermission(actor, "campaigns.view");

  const where: Prisma.CampaignWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.platform ? { platform: params.platform } : {}),
    ...(params.clientId ? { clientId: params.clientId } : {}),
  };

  const rows = await db.campaign.findMany({
    where,
    orderBy: [{ status: "asc" }, { startsAt: "desc" }],
    select: {
      id: true,
      name: true,
      platform: true,
      objective: true,
      status: true,
      budget: true,
      currency: true,
      startsAt: true,
      endsAt: true,
      client: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
      _count: { select: { metrics: true, leads: true } },
    },
  });

  return rows.map((row) => ({ ...row, budget: toMoneyString(row.budget) }));
}

export async function getCampaign(actor: Actor, id: string) {
  requirePermission(actor, "campaigns.view");

  const campaign = await db.campaign.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      platform: true,
      objective: true,
      status: true,
      budget: true,
      currency: true,
      startsAt: true,
      endsAt: true,
      clientId: true,
      ownerId: true,
      client: { select: { id: true, name: true } },
      owner: { select: { id: true, name: true } },
    },
  });

  if (!campaign) throw new NotFoundError("That campaign does not exist.");

  return { ...campaign, budget: toMoneyString(campaign.budget) };
}

export async function createCampaign(actor: Actor, input: CampaignInput) {
  requirePermission(actor, "campaigns.create");
  await assertReferences(input);

  return withAudit(
    { actor, action: "CREATE", entityType: "Campaign", entityId: input.name, after: input },
    (tx) =>
      tx.campaign.create({
        data: {
          name: input.name,
          clientId: input.clientId ?? null,
          platform: input.platform,
          objective: input.objective ?? null,
          budget: input.budget,
          currency: input.currency,
          ownerId: input.ownerId,
          status: input.status,
          startsAt: input.startsAt,
          endsAt: input.endsAt ?? null,
        },
        select: { id: true, name: true },
      }),
  );
}

export async function updateCampaign(actor: Actor, id: string, input: CampaignInput) {
  requirePermission(actor, "campaigns.edit");
  await assertReferences(input);

  const before = await db.campaign.findUnique({
    where: { id },
    select: { id: true, name: true, status: true, budget: true },
  });
  if (!before) throw new NotFoundError("That campaign does not exist.");

  return withAudit(
    { actor, action: "UPDATE", entityType: "Campaign", entityId: id, before, after: input },
    (tx) =>
      tx.campaign.update({
        where: { id },
        data: {
          name: input.name,
          clientId: input.clientId ?? null,
          platform: input.platform,
          objective: input.objective ?? null,
          budget: input.budget,
          currency: input.currency,
          ownerId: input.ownerId,
          status: input.status,
          startsAt: input.startsAt,
          endsAt: input.endsAt ?? null,
        },
        select: { id: true, name: true },
      }),
  );
}

/**
 * Deleting a campaign is refused once it carries data.
 *
 * Its metrics are the only record that the spend happened, and leads point at
 * it for attribution. Completing it keeps the history; deleting it would
 * quietly change past reports (CLAUDE.md 2 rule 10).
 */
export async function deleteCampaign(actor: Actor, id: string) {
  requirePermission(actor, "campaigns.delete");

  const campaign = await db.campaign.findUnique({
    where: { id },
    select: { id: true, name: true, _count: { select: { metrics: true, leads: true } } },
  });
  if (!campaign) throw new NotFoundError("That campaign does not exist.");

  if (campaign._count.metrics > 0 || campaign._count.leads > 0) {
    throw new ConflictError(
      "That campaign has performance data or attributed leads. Mark it completed instead.",
    );
  }

  return withAudit(
    { actor, action: "DELETE", entityType: "Campaign", entityId: id, before: campaign },
    (tx) => tx.campaign.delete({ where: { id }, select: { id: true } }),
  );
}

async function assertReferences(input: CampaignInput): Promise<void> {
  if (input.endsAt && input.endsAt <= input.startsAt) {
    throw new ValidationError("The end date must be after the start date.");
  }

  const owner = await db.user.findFirst({
    where: { id: input.ownerId, type: "STAFF" },
    select: { id: true },
  });
  if (!owner) throw new ValidationError("That owner is not a staff user.");

  if (input.clientId) {
    const client = await db.client.findFirst({
      where: { id: input.clientId, deletedAt: null },
      select: { id: true },
    });
    if (!client) throw new ValidationError("That client does not exist.");
  }
}

// ---------------------------------------------------------------------------
// Performance data
// ---------------------------------------------------------------------------

/** The day a metric belongs to, normalised to UTC midnight for the @db.Date column. */
function metricDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function listMetrics(actor: Actor, campaignId: string, range?: DateRange) {
  requirePermission(actor, "campaigns.view");

  const rows = await db.campaignMetric.findMany({
    where: { campaignId, ...(range ? { date: rangeFilter(range) } : {}) },
    orderBy: { date: "desc" },
    select: {
      id: true,
      date: true,
      impressions: true,
      clicks: true,
      conversions: true,
      spend: true,
      revenue: true,
      source: true,
    },
  });

  return rows.map((row) => ({
    ...row,
    spend: toMoneyString(row.spend),
    revenue: row.revenue === null ? null : toMoneyString(row.revenue),
  }));
}

/**
 * Record one day of performance.
 *
 * Upserted on `(campaignId, date)`: re-entering a day corrects it rather than
 * adding a second row that would double the spend.
 */
export async function recordMetric(
  actor: Actor,
  input: { campaignId: string; date: Date; impressions: number; clicks: number; conversions: number; spend: string; revenue?: string | null },
  source: "MANUAL" | "IMPORT" = "MANUAL",
) {
  requirePermission(actor, "campaigns.edit");

  const campaign = await db.campaign.findUnique({
    where: { id: input.campaignId },
    select: { id: true },
  });
  if (!campaign) throw new NotFoundError("That campaign does not exist.");

  if (input.clicks > input.impressions && input.impressions > 0) {
    throw new ValidationError("There cannot be more clicks than impressions.");
  }

  const date = metricDay(input.date);
  const data = {
    impressions: input.impressions,
    clicks: input.clicks,
    conversions: input.conversions,
    spend: input.spend,
    revenue: input.revenue ?? null,
    source,
  };

  return withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "CampaignMetric",
      entityId: `${input.campaignId}:${date.toISOString().slice(0, 10)}`,
      after: data,
    },
    (tx) =>
      tx.campaignMetric.upsert({
        where: { campaignId_date: { campaignId: input.campaignId, date } },
        create: { campaignId: input.campaignId, date, ...data },
        update: data,
        select: { id: true, date: true },
      }),
  );
}

export async function deleteMetric(actor: Actor, id: string) {
  requirePermission(actor, "campaigns.edit");

  const metric = await db.campaignMetric.findUnique({
    where: { id },
    select: { id: true, campaignId: true, date: true },
  });
  if (!metric) throw new NotFoundError("That row does not exist.");

  return withAudit(
    { actor, action: "DELETE", entityType: "CampaignMetric", entityId: id, before: metric },
    (tx) => tx.campaignMetric.delete({ where: { id }, select: { id: true } }),
  );
}

export type ImportOutcome = {
  imported: number;
  /** One message per rejected row, with its line number. Never silently dropped. */
  rejected: string[];
};

/**
 * Import daily rows from a CSV the user exported from the ad platform.
 *
 * Every row goes through the same Zod schema as manual entry. A malformed row
 * is reported with its line number and the rest still import — but nothing is
 * guessed, and a row that cannot be parsed is never written as zeroes.
 */
export async function importMetrics(
  actor: Actor,
  campaignId: string,
  csv: string,
): Promise<ImportOutcome> {
  requirePermission(actor, "campaigns.edit");

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true },
  });
  if (!campaign) throw new NotFoundError("That campaign does not exist.");

  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) throw new ValidationError("That file has no rows.");

  const header = lines[0]?.toLowerCase() ?? "";
  const hasHeader = header.includes("date");
  const rows = hasHeader ? lines.slice(1) : lines;

  if (rows.length === 0) throw new ValidationError("That file has a header but no rows.");
  if (rows.length > 1000) throw new ValidationError("Import at most 1000 rows at a time.");

  const rejected: string[] = [];
  const parsed: { date: Date; impressions: number; clicks: number; conversions: number; spend: string; revenue: string | null }[] = [];

  rows.forEach((line, index) => {
    const lineNumber = index + (hasHeader ? 2 : 1);
    const cells = line.split(",").map((cell) => cell.trim());

    if (cells.length < 5) {
      rejected.push(`Line ${lineNumber}: expected date,impressions,clicks,conversions,spend[,revenue].`);
      return;
    }

    const candidate = campaignMetricSchema.safeParse({
      campaignId,
      date: cells[0],
      impressions: cells[1],
      clicks: cells[2],
      conversions: cells[3],
      spend: cells[4],
      revenue: cells[5] ? cells[5] : null,
    });

    if (!candidate.success) {
      rejected.push(`Line ${lineNumber}: ${candidate.error.issues[0]?.message ?? "invalid row"}.`);
      return;
    }

    if (Number.isNaN(candidate.data.date.getTime())) {
      rejected.push(`Line ${lineNumber}: that is not a date.`);
      return;
    }

    parsed.push({
      date: metricDay(candidate.data.date),
      impressions: candidate.data.impressions,
      clicks: candidate.data.clicks,
      conversions: candidate.data.conversions,
      spend: candidate.data.spend,
      revenue: candidate.data.revenue ?? null,
    });
  });

  // A file that repeats a day would otherwise upsert twice; the last one wins,
  // which is what a corrected export means.
  const byDate = new Map<string, (typeof parsed)[number]>();
  for (const row of parsed) byDate.set(row.date.toISOString(), row);

  if (byDate.size > 0) {
    await withAudit(
      {
        actor,
        action: "UPDATE",
        entityType: "Campaign",
        entityId: campaignId,
        after: { imported: byDate.size, source: "IMPORT" },
      },
      async (tx) => {
        for (const row of byDate.values()) {
          const data = {
            impressions: row.impressions,
            clicks: row.clicks,
            conversions: row.conversions,
            spend: row.spend,
            revenue: row.revenue,
            source: "IMPORT" as const,
          };
          await tx.campaignMetric.upsert({
            where: { campaignId_date: { campaignId, date: row.date } },
            create: { campaignId, date: row.date, ...data },
            update: data,
          });
        }
        return { campaignId };
      },
    );
  }

  return { imported: byDate.size, rejected };
}
