import "server-only";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { withAudit } from "@/lib/services/audit.service";
import { decryptSecret, encryptSecret } from "@/lib/security/secret";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { resolveClientScope } from "@/lib/social/scope";
import { log } from "@/lib/logger";
import type { SocialAccountStatus, SocialProvider } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";
import type { ProviderAccount, ProviderCredentials } from "@/lib/social/types";

/**
 * Connected social accounts.
 *
 * **No function here returns a token.** The select list below is the whole
 * public shape of an account, and it has no token column in it — not masked,
 * not truncated, absent. A token reaches exactly one place: the provider
 * adapter, through `credentialsFor`, which is not exported to anything that
 * renders. Tokens are encrypted at rest with the same AES-256-GCM helper the
 * AI key uses (lib/security/secret.ts), and no audit row carries one either
 * (CLAUDE.md 11).
 *
 * Client isolation runs through `resolveClientScope`: a caller names a client,
 * the scope resolver decides whether that is allowed, and every query filters
 * on what it returns rather than on what was asked for.
 */

const accountLog = log("social");

/** Everything a screen may see. Deliberately no token fields. */
const accountSelect = {
  id: true,
  clientId: true,
  provider: true,
  externalId: true,
  name: true,
  username: true,
  profileUrl: true,
  status: true,
  scopes: true,
  tokenExpiresAt: true,
  lastSyncedAt: true,
  lastSyncError: true,
  failureCount: true,
  createdAt: true,
  updatedAt: true,
  avatar: { select: { id: true, url: true, alt: true } },
  connectedBy: { select: { id: true, name: true } },
} as const;

export type SocialAccountRow = Awaited<ReturnType<typeof listAccounts>>[number];

export async function listAccounts(actor: Actor, clientId: string | null) {
  requirePermission(actor, "social.view");
  const scope = await resolveClientScope(actor, clientId);

  return db.socialAccount.findMany({
    where: { clientId: scope },
    orderBy: [{ provider: "asc" }, { name: "asc" }],
    select: accountSelect,
  });
}

export async function getAccount(actor: Actor, id: string) {
  requirePermission(actor, "social.view");

  const account = await db.socialAccount.findUnique({
    where: { id },
    select: accountSelect,
  });
  if (!account) throw new NotFoundError("That account does not exist.");

  // Checked after loading rather than folded into the query: the answer must
  // be the same "does not exist" whether the account is missing or belongs to
  // someone else, so an id cannot be probed for existence.
  await resolveClientScope(actor, account.clientId);
  return account;
}

/**
 * Store the result of a completed OAuth exchange.
 *
 * Called only by the callback route, never by a form: the arguments are what
 * the provider returned, not what a browser posted. Re-connecting an account
 * that already exists updates it in place and clears the failure state, which
 * is what "Reconnect" means — a second row would split its published history.
 */
export async function connectAccount(
  actor: Actor,
  input: {
    clientId: string;
    provider: SocialProvider;
    account: ProviderAccount;
    credentials: ProviderCredentials;
  },
) {
  requirePermission(actor, "social.accounts.manage");
  const scope = await resolveClientScope(actor, input.clientId);

  // The same platform account cannot serve two clients: "whose post is this"
  // has to have one answer.
  const existing = await db.socialAccount.findUnique({
    where: { provider_externalId: { provider: input.provider, externalId: input.account.externalId } },
    select: { id: true, clientId: true },
  });
  if (existing && existing.clientId !== scope) {
    throw new ConflictError(
      `That ${PROVIDER_LABEL[input.provider]} account is already connected to another client.`,
    );
  }

  const credentials = {
    accessToken: encryptSecret(input.credentials.accessToken),
    refreshToken: input.credentials.refreshToken
      ? encryptSecret(input.credentials.refreshToken)
      : null,
    tokenExpiresAt: input.credentials.expiresAt,
  };

  const data = {
    clientId: scope,
    provider: input.provider,
    externalId: input.account.externalId,
    name: input.account.name,
    username: input.account.username,
    profileUrl: input.account.profileUrl,
    scopes: [...input.account.scopes],
    status: "CONNECTED" as SocialAccountStatus,
    lastSyncedAt: new Date(),
    lastSyncError: null,
    failureCount: 0,
    connectedById: actor.type === "STAFF" ? actor.userId : null,
    ...credentials,
  };

  const account = await withAudit(
    {
      actor,
      action: existing ? "UPDATE" : "CREATE",
      entityType: "SocialAccount",
      entityId: existing?.id ?? input.account.externalId,
      // The audit payload is built by hand rather than from the row, because
      // the row holds the encrypted token and an audit log is the last place
      // it should be copied to.
      after: {
        provider: input.provider,
        externalId: input.account.externalId,
        name: input.account.name,
        scopes: input.account.scopes,
        reconnected: Boolean(existing),
      },
    },
    (tx) =>
      existing
        ? tx.socialAccount.update({ where: { id: existing.id }, data, select: accountSelect })
        : tx.socialAccount.create({ data, select: accountSelect }),
  );

  accountLog.info(
    { provider: input.provider, clientId: scope, reconnected: Boolean(existing) },
    "social account connected",
  );
  return account;
}

/**
 * Disconnect, keeping the row.
 *
 * The credentials are cleared; the account, its posts and their published
 * history stay. Deleting the row would take a client's published record with
 * it, and "we no longer have access" is not the same as "this never happened".
 */
export async function disconnectAccount(actor: Actor, id: string) {
  requirePermission(actor, "social.accounts.manage");

  const before = await db.socialAccount.findUnique({
    where: { id },
    select: { id: true, clientId: true, provider: true, name: true, status: true },
  });
  if (!before) throw new NotFoundError("That account does not exist.");
  await resolveClientScope(actor, before.clientId);

  const account = await withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "SocialAccount",
      entityId: id,
      before: { provider: before.provider, name: before.name, status: before.status },
      after: { status: "DISCONNECTED" },
    },
    (tx) =>
      tx.socialAccount.update({
        where: { id },
        data: {
          status: "DISCONNECTED",
          accessToken: null,
          refreshToken: null,
          tokenExpiresAt: null,
          scopes: [],
        },
        select: accountSelect,
      }),
  );

  accountLog.info({ accountId: id, provider: before.provider }, "social account disconnected");
  return account;
}

/**
 * Record the outcome of a sync or a publication attempt against the account.
 *
 * Kept here rather than in each caller so "this account is failing" is one
 * definition. A failure does not immediately mark the account broken: providers
 * have bad minutes, and flipping an account to NEEDS_RECONNECT on one timeout
 * would send an operator to re-authorise something that was fine.
 */
const FAILURES_BEFORE_RECONNECT = 3;

export async function recordSyncResult(
  id: string,
  result: { ok: true } | { ok: false; error: string; credentialsRejected?: boolean },
) {
  if (result.ok) {
    await db.socialAccount.update({
      where: { id },
      data: { lastSyncedAt: new Date(), lastSyncError: null, failureCount: 0, status: "CONNECTED" },
    });
    return;
  }

  const current = await db.socialAccount.findUnique({
    where: { id },
    select: { failureCount: true, status: true },
  });
  if (!current) return;

  const failureCount = current.failureCount + 1;
  const needsReconnect =
    result.credentialsRejected === true || failureCount >= FAILURES_BEFORE_RECONNECT;

  await db.socialAccount.update({
    where: { id },
    data: {
      lastSyncError: result.error.slice(0, 500),
      failureCount,
      ...(needsReconnect && current.status === "CONNECTED"
        ? { status: "NEEDS_RECONNECT" as SocialAccountStatus }
        : {}),
    },
  });
}

/**
 * The decrypted credentials for an account.
 *
 * **Server-only, and not for rendering.** The one caller is the provider
 * adapter at the moment it makes a request. It is not exported through any
 * barrel, no server action returns its result, and nothing puts it in a prop.
 *
 * Returns null when the token cannot be decrypted — which happens after
 * `AUTH_SECRET` is rotated — rather than throwing, so the account shows as
 * needing reconnection instead of the screen breaking.
 */
export async function credentialsFor(id: string): Promise<ProviderCredentials | null> {
  const row = await db.socialAccount.findUnique({
    where: { id },
    select: { accessToken: true, refreshToken: true, tokenExpiresAt: true, status: true },
  });
  if (!row || !row.accessToken || row.status === "DISCONNECTED") return null;

  const accessToken = decryptSecret(row.accessToken);
  if (!accessToken) {
    await db.socialAccount.update({
      where: { id },
      data: {
        status: "NEEDS_RECONNECT",
        lastSyncError: "Stored credentials could not be read. Reconnect the account.",
      },
    });
    return null;
  }

  return {
    accessToken,
    refreshToken: row.refreshToken ? decryptSecret(row.refreshToken) : null,
    expiresAt: row.tokenExpiresAt,
  };
}

/** Health, for the accounts screen. Derived, never stored. */
export type AccountHealth = "HEALTHY" | "EXPIRING" | "ATTENTION" | "DISCONNECTED";

const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

export function accountHealth(account: {
  status: SocialAccountStatus;
  tokenExpiresAt: Date | null;
  failureCount: number;
}): AccountHealth {
  if (account.status === "DISCONNECTED") return "DISCONNECTED";
  if (account.status === "NEEDS_RECONNECT") return "ATTENTION";
  if (account.failureCount > 0) return "ATTENTION";
  if (
    account.tokenExpiresAt &&
    account.tokenExpiresAt.getTime() - Date.now() < EXPIRY_WARNING_MS
  ) {
    return "EXPIRING";
  }
  return "HEALTHY";
}

/** Guard used by the OAuth callback before it trusts a provider's account. */
export function assertConnectable(account: ProviderAccount): void {
  if (!account.externalId.trim()) {
    throw new ValidationError("The provider returned an account with no id.");
  }
  if (!account.name.trim()) {
    throw new ValidationError("The provider returned an account with no name.");
  }
}
