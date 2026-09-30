import type { Metadata } from "next";
import { requireActorPage } from "@/lib/actor";
import { can } from "@/lib/auth/rbac";
import { accountHealth, accountWarnings, listAccounts, nextSyncAt } from "@/lib/services/social-account.service";
import { providerStatuses } from "@/lib/social";
import { AccountsPanel, type AccountRow, type ProviderRow } from "./accounts-panel";

export const metadata: Metadata = { title: "Social accounts" };
export const dynamic = "force-dynamic";

/**
 * A client's connected social accounts.
 *
 * The screen answers three questions in order: what is connected, is it
 * healthy, and what can I still connect. The third matters as much as the
 * first — a provider that has no adapter yet, and one whose credentials simply
 * have not been entered, are different problems with different fixes, and the
 * screen says which is which rather than showing a dead button.
 */
export default async function SocialAccountsPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const actor = await requireActorPage(`/admin/clients/${clientId}/social/accounts`);

  const [accounts, providers] = await Promise.all([
    listAccounts(actor, clientId),
    providerStatuses(),
  ]);

  const configured = new Map(providers.map((provider) => [provider.provider, provider.configured]));
  const now = new Date();

  const rows: AccountRow[] = accounts.map((account) => {
    const health = { ...account, providerConfigured: configured.get(account.provider) ?? false };
    // An unconfigured platform is skipped by the scheduled check, so it has no next check.
    const next = health.providerConfigured ? nextSyncAt(account) : null;
    return {
      id: account.id,
      provider: account.provider,
      name: account.name,
      username: account.username,
      profileUrl: account.profileUrl,
      status: account.status,
      health: accountHealth(health),
      warnings: accountWarnings(health, now).map(({ text, attention }) => ({ text, attention })),
      lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
      nextSyncAt: next?.toISOString() ?? null,
      // Overdue: the next scheduled run picks it up, whatever the clock says.
      nextSyncDue: next !== null && next.getTime() <= now.getTime(),
      lastSyncError: account.lastSyncError,
      tokenExpiresAt: account.tokenExpiresAt?.toISOString() ?? null,
      // Null when the platform never said: the screen reads "not reported",
      // not an empty list that looks like "granted nothing".
      scopes: account.scopesReportedAt ? account.scopes : null,
      connectedBy: account.connectedBy?.name ?? null,
    };
  });

  const connected = new Set(
    accounts.filter((a) => a.status !== "DISCONNECTED").map((a) => a.provider),
  );

  const available: ProviderRow[] = providers.map((provider) => ({
    provider: provider.provider,
    label: provider.label,
    configured: provider.configured,
    implemented: provider.implemented,
    connected: connected.has(provider.provider),
    formats: provider.capabilities.postTypes.length,
  }));

  return (
    <AccountsPanel
      clientId={clientId}
      accounts={rows}
      providers={available}
      canManage={can(actor, "social.accounts.manage")}
    />
  );
}
