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
import type {
  ProviderAccount,
  ProviderCredentials,
  SocialProviderAdapter,
} from "@/lib/social/types";

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

  const accounts = await db.socialAccount.findMany({
    where: { clientId: scope },
    orderBy: [{ provider: "asc" }, { name: "asc" }],
    select: accountSelect,
  });

  // Whether each account holds a refresh token — asked as a yes/no of its own
  // so the token column never enters a select a screen can see.
  const renewable = new Set(
    (
      await db.socialAccount.findMany({
        where: { id: { in: accounts.map((a) => a.id) }, refreshToken: { not: null } },
        select: { id: true },
      })
    ).map((a) => a.id),
  );
  return accounts.map((account) => ({ ...account, renewsItself: renewable.has(account.id) }));
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
    externalParentId: input.account.externalParentId ?? null,
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
export async function credentialsFor(
  id: string,
  client: Pick<typeof db, "socialAccount"> = db,
): Promise<ProviderCredentials | null> {
  const row = await client.socialAccount.findUnique({
    where: { id },
    select: { accessToken: true, refreshToken: true, tokenExpiresAt: true, status: true },
  });
  if (!row || !row.accessToken || row.status === "DISCONNECTED") return null;

  const accessToken = decryptSecret(row.accessToken);
  if (!accessToken) {
    await client.socialAccount.update({
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

/**
 * Ask the provider whether the connection still works, and refresh what it
 * tells us about the account.
 *
 * This is both "Test connection" and "Sync now": there is no useful difference
 * between them at this stage, and two buttons that do the same thing is two
 * things to keep in step. A success updates the account's name, handle and
 * avatar URL — people rename accounts — and clears the failure state. A
 * failure is recorded against the account rather than thrown away, so the
 * accounts screen can show *why* something is amber.
 *
 * Returns the outcome instead of throwing, because the caller is a button and
 * the interesting answer is "it did not work, here is what to do".
 */
export async function syncAccount(
  actor: Actor,
  id: string,
  /** Which adapter serves a provider. Injected by tests; the registry otherwise. */
  resolve?: (provider: SocialProvider) => Promise<SocialProviderAdapter>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  requirePermission(actor, "social.accounts.manage");

  const account = await db.socialAccount.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      provider: true,
      status: true,
      externalId: true,
      externalParentId: true,
    },
  });
  if (!account) throw new NotFoundError("That account does not exist.");
  await resolveClientScope(actor, account.clientId);

  if (account.status === "DISCONNECTED") {
    return { ok: false, message: "This account is disconnected. Connect it again to use it." };
  }

  const adapter = resolve
    ? await resolve(account.provider)
    : await (await import("@/lib/social")).socialProvider(account.provider);
  if (!adapter.configured) {
    return {
      ok: false,
      message: `${PROVIDER_LABEL[account.provider]} is not configured in this deployment.`,
    };
  }

  // Renewed first, like every other use. Checking with the stored token as-is
  // meant an hour-long Google token, idle past its hour, came back 401 and a
  // healthy channel was marked for reconnection by the button meant to
  // confirm it was fine.
  const credentials = await usableCredentials(id, adapter);
  if (!credentials) {
    return {
      ok: false,
      message: "The stored credentials could not be used. Reconnect the account.",
    };
  }

  try {
    const fresh = await adapter.getAccount(credentials, {
      externalId: account.externalId,
      externalParentId: account.externalParentId,
    });
    await db.socialAccount.update({
      where: { id },
      data: {
        name: fresh.name,
        username: fresh.username,
        profileUrl: fresh.profileUrl,
        scopes: [...fresh.scopes],
      },
    });
    await recordSyncResult(id, { ok: true });
    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error && "publicMessage" in error
        ? String((error as { publicMessage: string }).publicMessage)
        : "The provider could not be reached.";

    // A 401/403 means the credentials themselves are gone, which is a
    // different state from a bad minute and is marked immediately.
    const rejected = /reconnect|rejected|expired/i.test(message);
    await recordSyncResult(id, { ok: false, error: message, credentialsRejected: rejected });

    accountLog.warn({ accountId: id, provider: account.provider }, "social account sync failed");
    return { ok: false, message };
  }
}

/** Health, for the accounts screen. Derived, never stored. */
export type AccountHealth = "HEALTHY" | "EXPIRING" | "ATTENTION" | "DISCONNECTED";

const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

export function accountHealth(account: {
  status: SocialAccountStatus;
  tokenExpiresAt: Date | null;
  failureCount: number;
  /**
   * Holds a refresh token, so the access token's expiry is routine rather
   * than a warning. Google's access tokens last an hour; without this every
   * YouTube account would read "expiring soon" for ever.
   */
  renewsItself?: boolean;
}): AccountHealth {
  if (account.status === "DISCONNECTED") return "DISCONNECTED";
  if (account.status === "NEEDS_RECONNECT") return "ATTENTION";
  if (account.failureCount > 0) return "ATTENTION";
  if (
    !account.renewsItself &&
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

/**
 * Refresh this far ahead of expiry, so a post never goes out on a dying token.
 *
 * A day, for tokens that can only be renewed while they still work (Instagram
 * renews by presenting itself). An account holding a refresh token can be
 * renewed at any moment, even after expiry, so it waits for the last
 * `REFRESHABLE_MARGIN_MS` — otherwise a one-hour Google or two-hour X token,
 * always "within a day of expiry", would be renewed on every single use.
 */
const REFRESH_BEFORE_MS = 24 * 60 * 60 * 1000;
const REFRESHABLE_MARGIN_MS = 15 * 60 * 1000;

/**
 * Credentials that will actually work for the next call.
 *
 * `credentialsFor` decrypts what is stored; this also refreshes it when it is
 * about to expire and the platform issued a refresh token. Before this existed
 * nothing called `refresh()` at all, so a LinkedIn token quietly reached its
 * sixty-day end and every scheduled post failed with "reconnect the account"
 * while the accounts screen still said healthy.
 *
 * A failed refresh marks the account as needing reconnection through the same
 * `recordSyncResult` the sync path uses, so the screen and the engine agree.
 * Returns null when there is nothing usable, and the caller says so.
 */
export async function usableCredentials(
  id: string,
  adapter: Pick<SocialProviderAdapter, "refresh" | "refreshesWithAccessToken">,
  now = new Date(),
  windowMs = REFRESH_BEFORE_MS,
): Promise<ProviderCredentials | null> {
  const credentials = await credentialsFor(id);
  if (!credentials) return null;

  const expiring = (c: ProviderCredentials) =>
    c.expiresAt !== null &&
    c.expiresAt.getTime() - now.getTime() <
      (c.refreshToken ? Math.min(windowMs, REFRESHABLE_MARGIN_MS) : windowMs);
  if (!expiring(credentials)) return credentials;

  const canRefresh = Boolean(credentials.refreshToken) || adapter.refreshesWithAccessToken === true;
  if (!canRefresh) {
    // Nothing to refresh with. If it has already expired, say so now rather
    // than letting the platform say it three times.
    if (credentials.expiresAt!.getTime() <= now.getTime()) {
      await recordSyncResult(id, {
        ok: false,
        error: "The access token has expired. Reconnect the account.",
        credentialsRejected: true,
      });
      return null;
    }
    return credentials;
  }

  // One renewal per account at a time. X's refresh tokens are single-use and
  // rotate: two renewals racing — an overlapping cron run, the Check button
  // pressed mid-run — would spend the same refresh token twice, and the
  // loser's refusal would mark a healthy account for reconnection. So the
  // renewal holds a per-account advisory lock, and whoever gets it second
  // re-reads and uses the token the first one just obtained.
  let failure: string | null = null;
  const renewed = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`social-credentials:${id}`}))`;

      const current = await credentialsFor(id, tx);
      if (!current) return null;
      // Renewed by whoever held the lock before us: use theirs. Presenting
      // the refresh token again would spend it twice.
      if (current.accessToken !== credentials.accessToken || !expiring(current)) return current;

      try {
        const fresh = await adapter.refresh(current);
        // Some platforms rotate the refresh token, some keep the old one, and
        // some (Instagram) never issue one at all.
        const refreshToken = fresh.refreshToken ?? current.refreshToken;
        await tx.socialAccount.update({
          where: { id },
          data: {
            accessToken: encryptSecret(fresh.accessToken),
            refreshToken: refreshToken ? encryptSecret(refreshToken) : null,
            tokenExpiresAt: fresh.expiresAt,
          },
        });
        return { ...fresh, refreshToken };
      } catch (error) {
        failure = error instanceof Error ? error.message : "The access token could not be refreshed.";
        return null;
      }
    },
    // The refresh is a network call made while the lock is held; bounded by
    // the adapter's own timeout, well inside this.
    { timeout: 60_000, maxWait: 30_000 },
  );

  if (failure) {
    await recordSyncResult(id, { ok: false, error: failure, credentialsRejected: true });
    return null;
  }
  return renewed;
}

/** How far ahead the keep-alive renews a token that renews itself. */
const KEEP_ALIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Renew tokens that would otherwise lapse while nobody is posting.
 *
 * Credentials are refreshed when they are *used* — publishing, reading
 * metrics. An account that sits idle is never used, so an Instagram token,
 * which is extended by presenting it and has no refresh token behind it,
 * would quietly reach its sixty-day end and the next scheduled post would
 * find the account dead. This runs from the cron and renews such a token in
 * its last week.
 *
 * Accounts with a refresh token are left alone: their access token is
 * renewed on demand and the refresh token itself is long-lived, so renewing
 * an hour-long Google token every few minutes would be busywork. A failed
 * renewal marks the account through `usableCredentials`, as any refresh does.
 */
export async function renewIdleCredentials(
  resolve: (provider: SocialProvider) => Promise<Pick<SocialProviderAdapter, "configured" | "refresh" | "refreshesWithAccessToken">>,
  now = new Date(),
): Promise<{ renewed: number; failed: number }> {
  const due = await db.socialAccount.findMany({
    where: {
      status: "CONNECTED",
      accessToken: { not: null },
      refreshToken: null,
      tokenExpiresAt: { not: null, lt: new Date(now.getTime() + KEEP_ALIVE_WINDOW_MS) },
    },
    select: { id: true, provider: true },
    take: 200,
  });

  let renewed = 0;
  let failed = 0;
  for (const account of due) {
    const adapter = await resolve(account.provider);
    if (!adapter.configured || adapter.refreshesWithAccessToken !== true) continue;
    const fresh = await usableCredentials(account.id, adapter, now, KEEP_ALIVE_WINDOW_MS);
    if (fresh) renewed += 1;
    else failed += 1;
  }
  return { renewed, failed };
}