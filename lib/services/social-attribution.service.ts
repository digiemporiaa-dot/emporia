import "server-only";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { can, requirePermission } from "@/lib/auth/rbac";
import { resolveClientScope } from "@/lib/social/scope";
import { seesWholeTeam, visibilityFilter } from "@/lib/services/crm.service";
import { convertingLeads, revenueByClient } from "@/lib/services/analytics.service";
import { campaignForTouch } from "@/lib/attribution/server";
import { SOCIAL_SOURCES } from "@/lib/social/utm";
import { Decimal, toMoneyString, ZERO } from "@/lib/money";
import type { DateRange } from "@/lib/analytics/range";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";

/**
 * Social → lead → opportunity → client → revenue, for one client (brief §42).
 *
 * **Only what the CRM can prove.** A lead counts when it was captured on this
 * website and its *last touch* (the convention lead capture already uses)
 * carries this client's social tags:
 *
 *  - a `utm_content` stamped on one of this client's posts — the lead is
 *    traced to that post and its campaign; or
 *  - a social touch (`utm_medium=social`, or a social `utm_source`) whose
 *    campaign resolves to one of this client's campaigns, by the same rule
 *    lead capture uses (`campaignForTouch`) — or already did, in the lead's
 *    own `campaignId`.
 *
 * Nothing is inferred from timing, reach or "people who saw a post". Traffic
 * sent to a client's own website never reaches this CRM, so for most clients
 * this section is honestly empty; it fills when links point at pages on this
 * site.
 *
 * Money follows the CRM's rules, reused rather than restated: opportunity
 * values need `opportunities.view`; revenue needs `invoices.view` and is the
 * money *received in the period* from clients whose first converting lead is
 * attributed here (`convertingLeads` + `revenueByClient`), so one client's
 * money is never counted twice. Lead counts respect the viewer's lead
 * visibility — someone who sees only their own leads sees only those here.
 */

/** Leads examined per report, newest first; hitting it is reported, never hidden. */
const LEAD_CAP = 5_000;

export type AttributionRow = {
  id: string;
  label: string;
  leads: number;
  opportunities: number;
  /** Open opportunities' value. Null without `opportunities.view`. */
  pipeline: string | null;
  /** Won opportunities' value. Null without `opportunities.view`. */
  won: string | null;
  clients: number;
  /** Received in the period. Null without `invoices.view`. */
  revenue: string | null;
};

export type PostAttributionRow = AttributionRow & { itemId: string; provider: SocialProvider };

export type SocialAttribution =
  | { available: false; reason: "no-lead-access" }
  | {
      available: true;
      totals: Omit<AttributionRow, "id" | "label">;
      campaigns: AttributionRow[];
      posts: PostAttributionRow[];
      ownLeadsOnly: boolean;
      moneyWithheld: { opportunities: boolean; revenue: boolean };
      truncated: boolean;
    };

type Bucket = {
  leads: number;
  opportunities: number;
  pipeline: Decimal;
  won: Decimal;
  clients: number;
  revenue: Decimal;
};

const empty = (): Bucket => ({ leads: 0, opportunities: 0, pipeline: ZERO, won: ZERO, clients: 0, revenue: ZERO });
const NO_CAMPAIGN = "__none__";

export async function socialAttribution(
  actor: Actor,
  input: { clientId: string; range: DateRange },
): Promise<SocialAttribution> {
  requirePermission(actor, "social.analytics.view");
  // The CRM is the agency's; a portal user never reads it through here.
  if (actor.type !== "STAFF") throw new NotFoundError("That client does not exist.");
  const scope = await resolveClientScope(actor, input.clientId);
  if (!can(actor, "leads.view")) return { available: false, reason: "no-lead-access" };

  const seesDeals = can(actor, "opportunities.view");
  const seesRevenue = can(actor, "invoices.view");

  const [campaigns, posts] = await Promise.all([
    db.campaign.findMany({ where: { clientId: scope }, select: { id: true, name: true } }),
    db.socialPost.findMany({
      where: { clientId: scope, utmContent: { not: null } },
      select: { id: true, utmContent: true, provider: true, contentItem: { select: { id: true, title: true, campaignId: true } } },
    }),
  ]);
  const campaignIds = new Set(campaigns.map((c) => c.id));
  const byTag = new Map(posts.map((post) => [post.utmContent!, post]));

  const leads = await db.lead.findMany({
    where: {
      ...visibilityFilter(actor),
      deletedAt: null,
      lastTouch: {
        OR: [
          { medium: { equals: "social", mode: "insensitive" } },
          { source: { in: [...SOCIAL_SOURCES] } },
          ...(byTag.size > 0 ? [{ content: { in: [...byTag.keys()] } }] : []),
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: LEAD_CAP + 1,
    select: {
      id: true,
      createdAt: true,
      campaignId: true,
      convertedClientId: true,
      lastTouch: { select: { source: true, medium: true, campaign: true, content: true } },
      opportunities: { select: { stage: true, value: true } },
    },
  });
  const truncated = leads.length > LEAD_CAP;
  const examined = truncated ? leads.slice(0, LEAD_CAP) : leads;

  // A campaign value resolves the same way lead capture resolves it — once per
  // distinct value, not once per lead.
  const resolved = new Map<string, string | null>();
  const resolveCampaign = async (campaign: string | null, content: string | null) => {
    const key = `${campaign ?? ""}\u0000${content ?? ""}`;
    if (!resolved.has(key)) resolved.set(key, await campaignForTouch(db, { campaign: campaign ?? undefined, content: content ?? undefined }));
    return resolved.get(key)!;
  };

  type Attributed = { leadId: string; campaignKey: string; postId: string | null; inRange: boolean; lead: (typeof examined)[number] };
  const attributed: Attributed[] = [];

  for (const lead of examined) {
    const touch = lead.lastTouch;
    if (!touch) continue;
    const post = touch.content ? byTag.get(touch.content.trim().toLowerCase()) : undefined;
    // The query above already fetches only social or post-tagged touches; this
    // restates the rule where it is applied, so the loop stays right even if
    // the query is ever widened.
    const social = touch.medium?.toLowerCase() === "social" || (touch.source !== null && SOCIAL_SOURCES.includes(touch.source));

    let campaignId: string | null = null;
    if (post) {
      campaignId = post.contentItem.campaignId;
    } else if (social) {
      if (lead.campaignId && campaignIds.has(lead.campaignId)) campaignId = lead.campaignId;
      else {
        const found = await resolveCampaign(touch.campaign, touch.content);
        if (found && campaignIds.has(found)) campaignId = found;
      }
    }
    if (!post && !campaignId) continue;

    const inRange =
      (!input.range.from || lead.createdAt >= input.range.from) && lead.createdAt < input.range.to;
    attributed.push({ leadId: lead.id, campaignKey: campaignId ?? NO_CAMPAIGN, postId: post?.id ?? null, inRange, lead });
  }

  // Revenue: the CRM's own rule — money received in the period, credited once
  // per client to the lead that converted it first.
  const revenue = new Map<string, Decimal>();
  if (seesRevenue && attributed.length > 0) {
    const [received, firsts] = await Promise.all([revenueByClient(input.range), convertingLeads(visibilityFilter(actor))]);
    const firstFor = new Map(firsts.map((row) => [row.leadId, row.clientId]));
    for (const row of attributed) {
      const clientId = firstFor.get(row.leadId);
      const amount = clientId ? received.received.get(clientId) : undefined;
      if (amount && !amount.isZero()) revenue.set(row.leadId, amount);
    }
  }

  const totals = empty();
  const byCampaign = new Map<string, Bucket>();
  const byPost = new Map<string, Bucket>();
  const add = (bucket: Bucket, row: Attributed) => {
    const money = revenue.get(row.leadId);
    if (money) bucket.revenue = bucket.revenue.plus(money);
    if (!row.inRange) return;
    bucket.leads += 1;
    if (row.lead.convertedClientId) bucket.clients += 1;
    for (const opportunity of row.lead.opportunities) {
      bucket.opportunities += 1;
      const value = new Decimal(opportunity.value.toString());
      if (opportunity.stage === "WON") bucket.won = bucket.won.plus(value);
      else if (opportunity.stage !== "LOST") bucket.pipeline = bucket.pipeline.plus(value);
    }
  };
  for (const row of attributed) {
    add(totals, row);
    add(byCampaign.get(row.campaignKey) ?? byCampaign.set(row.campaignKey, empty()).get(row.campaignKey)!, row);
    if (row.postId) add(byPost.get(row.postId) ?? byPost.set(row.postId, empty()).get(row.postId)!, row);
  }

  const present = (bucket: Bucket): Omit<AttributionRow, "id" | "label"> => ({
    leads: bucket.leads,
    opportunities: bucket.opportunities,
    pipeline: seesDeals ? toMoneyString(bucket.pipeline) : null,
    won: seesDeals ? toMoneyString(bucket.won) : null,
    clients: bucket.clients,
    revenue: seesRevenue ? toMoneyString(bucket.revenue) : null,
  });
  const names = new Map(campaigns.map((c) => [c.id, c.name]));
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const meaningful = (bucket: Bucket) => bucket.leads > 0 || !bucket.revenue.isZero();
  const order = (a: Bucket, b: Bucket) => b.revenue.comparedTo(a.revenue) || b.won.comparedTo(a.won) || b.leads - a.leads;

  return {
    available: true,
    totals: present(totals),
    campaigns: [...byCampaign.entries()]
      .filter(([, bucket]) => meaningful(bucket))
      .sort(([, a], [, b]) => order(a, b))
      .map(([id, bucket]) => ({ id, label: id === NO_CAMPAIGN ? "No campaign" : (names.get(id) ?? "Deleted campaign"), ...present(bucket) })),
    posts: [...byPost.entries()]
      .filter(([, bucket]) => meaningful(bucket))
      .sort(([, a], [, b]) => order(a, b))
      .slice(0, 10)
      .map(([id, bucket]) => {
        const post = postsById.get(id)!;
        return { id, label: post.contentItem.title, itemId: post.contentItem.id, provider: post.provider, ...present(bucket) };
      }),
    ownLeadsOnly: !seesWholeTeam(actor),
    moneyWithheld: { opportunities: !seesDeals, revenue: !seesRevenue },
    truncated,
  };
}
