import "server-only";
import { db } from "@/lib/db";
import { can, requirePermission } from "@/lib/auth/rbac";
import { resolveClientScope } from "@/lib/social/scope";
import { providerStatuses } from "@/lib/social";
import { accountHealth, listAccounts } from "@/lib/services/social-account.service";
import { periodSummary } from "@/lib/services/social-summary.service";
import { CALENDAR_TIME_ZONE, startOfZonedDay, zonedDay } from "@/lib/social/calendar";
import type { Actor } from "@/lib/actor/types";

/**
 * A client's social section at a glance (brief §7).
 *
 * Every figure is a count or a sum of stored rows. This month's performance
 * comes from `periodSummary` — the same function the monthly report uses — and
 * is only returned to someone who may see analytics.
 */
export async function socialOverview(actor: Actor, clientId: string, now = new Date()) {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, clientId);

  const today = zonedDay(now, CALENDAR_TIME_ZONE);
  const monthStart = startOfZonedDay({ year: today.year, month: today.month, day: 1 }, CALENDAR_TIME_ZONE);
  const nextMonth = startOfZonedDay(
    today.month === 12 ? { year: today.year + 1, month: 1, day: 1 } : { year: today.year, month: today.month + 1, day: 1 },
    CALENDAR_TIME_ZONE,
  );

  const [accounts, providers, internalReviews, clientApprovals, scheduled, failed, month] = await Promise.all([
    listAccounts(actor, scope),
    providerStatuses(),
    db.socialInternalReview.count({ where: { clientId: scope, status: "PENDING" } }),
    db.approval.count({ where: { clientId: scope, status: "PENDING", contentItem: { socialPosts: { some: {} } } } }),
    db.socialPost.count({ where: { clientId: scope, status: "SCHEDULED" } }),
    db.socialPost.count({ where: { clientId: scope, status: "FAILED" } }),
    can(actor, "social.analytics.view") ? periodSummary(scope, monthStart, nextMonth) : Promise.resolve(null),
  ]);

  return {
    month: { from: monthStart, to: nextMonth, label: new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: CALENDAR_TIME_ZONE }).format(monthStart) },
    platforms: providers.map((provider) => ({
      provider: provider.provider,
      label: provider.label,
      configured: provider.configured,
      implemented: provider.implemented,
      accounts: accounts
        .filter((account) => account.provider === provider.provider && account.status !== "DISCONNECTED")
        .map((account) => ({
          id: account.id,
          name: account.name,
          health: accountHealth({ ...account, providerConfigured: provider.configured }),
        })),
    })),
    work: { internalReviews, clientApprovals, scheduled, failed },
    performance: month,
  };
}

export type SocialOverview = Awaited<ReturnType<typeof socialOverview>>;
