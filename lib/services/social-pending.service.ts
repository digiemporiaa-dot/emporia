import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { decryptSecret, encryptSecret } from "@/lib/security/secret";
import { resolveClientScope } from "@/lib/social/scope";
import { socialProvider } from "@/lib/social";
import { assertConnectable, connectAccount } from "@/lib/services/social-account.service";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";
import type {
  ProviderAccount,
  ProviderCredentials,
  SocialProviderAdapter,
} from "@/lib/social/types";

/**
 * The step between "signed in" and "connected" for platforms where one
 * sign-in reaches many accounts.
 *
 * A Facebook login manages every Page its owner administers; an agency
 * operator's login may manage forty. Connecting "the first one" would attach
 * the wrong client's Page often enough to matter, so the callback parks the
 * grant here and the operator chooses.
 *
 * What is held, and for how long:
 *
 * - the **user-level** credentials, encrypted, for `TTL_MS`. Not the Page
 *   tokens: those are fetched again at the moment of choosing and written
 *   straight onto the account, so the only token that ever waits is the one
 *   that was going to be discarded anyway;
 * - the **options** as shown — name, handle, profile link. Never a token.
 *
 * Every read re-checks the whole chain, because the picker URL is just a URL:
 * the operator must be the one who signed in, must still hold
 * `social.accounts.manage`, must still reach the client, and the grant must
 * not have expired. A colleague who opens the link sees nothing.
 */

const TTL_MS = 15 * 60 * 1000;

const optionSchema = z.object({
  externalId: z.string().min(1),
  name: z.string().min(1),
  username: z.string().nullable(),
  profileUrl: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
const optionsSchema = z.array(optionSchema);

export type PendingOption = z.infer<typeof optionSchema>;

type Resolve = (provider: SocialProvider) => Promise<SocialProviderAdapter>;

function staffId(actor: Actor): string {
  if (actor.type !== "STAFF") throw new ForbiddenError("Only staff can connect social accounts.");
  return actor.userId;
}

export async function startPendingConnection(
  actor: Actor,
  input: {
    clientId: string;
    provider: SocialProvider;
    credentials: ProviderCredentials;
    accounts: readonly ProviderAccount[];
    returnTo: string;
  },
  now = new Date(),
): Promise<string> {
  requirePermission(actor, "social.accounts.manage");
  const startedById = staffId(actor);
  const clientId = await resolveClientScope(actor, input.clientId);

  if (input.accounts.length === 0) {
    throw new ValidationError("That sign-in manages no accounts that can be connected.");
  }

  // Housekeeping on the way in. Expired grants are useless, and holding a
  // token longer than necessary is exactly what this table is built to avoid.
  await db.socialPendingConnection.deleteMany({ where: { expiresAt: { lt: now } } });

  const options: PendingOption[] = input.accounts.map((account) => ({
    externalId: account.externalId,
    name: account.name,
    username: account.username,
    profileUrl: account.profileUrl,
    avatarUrl: account.avatarUrl,
  }));

  const row = await db.socialPendingConnection.create({
    data: {
      clientId,
      provider: input.provider,
      startedById,
      credentials: encryptSecret(
        JSON.stringify({
          accessToken: input.credentials.accessToken,
          refreshToken: input.credentials.refreshToken,
          expiresAt: input.credentials.expiresAt?.toISOString() ?? null,
        }),
      ),
      options,
      returnTo: input.returnTo,
      expiresAt: new Date(now.getTime() + TTL_MS),
    },
    select: { id: true },
  });
  return row.id;
}

/** Load a grant and prove this actor may act on it. */
async function authorised(actor: Actor, id: string, now: Date) {
  requirePermission(actor, "social.accounts.manage");
  const userId = staffId(actor);

  const row = await db.socialPendingConnection.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      provider: true,
      startedById: true,
      credentials: true,
      options: true,
      returnTo: true,
      expiresAt: true,
    },
  });
  // Someone else's grant reads as missing, not forbidden: its existence is
  // nobody else's business.
  if (!row || row.startedById !== userId) {
    throw new NotFoundError("That connection has expired. Start it again.");
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.socialPendingConnection.deleteMany({ where: { id } });
    throw new NotFoundError("That connection has expired. Start it again.");
  }
  await resolveClientScope(actor, row.clientId);

  return { ...row, options: optionsSchema.parse(row.options) };
}

export type PendingConnectionView = {
  id: string;
  clientId: string;
  provider: SocialProvider;
  expiresAt: Date;
  returnTo: string;
  options: (PendingOption & { connectedHere: boolean; connectedElsewhere: boolean })[];
};

/** What the picker shows. No credential leaves this function. */
export async function getPendingConnection(
  actor: Actor,
  id: string,
  now = new Date(),
): Promise<PendingConnectionView> {
  const row = await authorised(actor, id, now);

  const taken = await db.socialAccount.findMany({
    where: {
      provider: row.provider,
      externalId: { in: row.options.map((o) => o.externalId) },
      status: { not: "DISCONNECTED" },
    },
    select: { externalId: true, clientId: true },
  });
  const owner = new Map(taken.map((t) => [t.externalId, t.clientId]));

  return {
    id: row.id,
    clientId: row.clientId,
    provider: row.provider,
    expiresAt: row.expiresAt,
    returnTo: row.returnTo,
    options: row.options.map((option) => {
      const clientId = owner.get(option.externalId);
      return {
        ...option,
        connectedHere: clientId === row.clientId,
        // Which client is not said — only that the Page is spoken for.
        connectedElsewhere: clientId !== undefined && clientId !== row.clientId,
      };
    }),
  };
}

/**
 * Connect the chosen account.
 *
 * The choice must be one of the options this grant offered: an id typed into
 * the request is not a way to connect a Page the sign-in never listed.
 */
export async function completePendingConnection(
  actor: Actor,
  id: string,
  externalId: string,
  resolve: Resolve = socialProvider,
  now = new Date(),
) {
  const row = await authorised(actor, id, now);

  if (!row.options.some((o) => o.externalId === externalId)) {
    throw new ValidationError("Choose one of the accounts listed.");
  }

  const adapter = await resolve(row.provider);
  if (!adapter.configured || !adapter.selectAccount) {
    throw new ValidationError(`${adapter.label} is not configured any more.`);
  }

  const stored = JSON.parse(decryptSecret(row.credentials) ?? "null") as {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: string | null;
  } | null;
  if (!stored) {
    // AUTH_SECRET rotated between sign-in and choice. Rare, and honest.
    await db.socialPendingConnection.deleteMany({ where: { id } });
    throw new NotFoundError("That connection has expired. Start it again.");
  }

  const selected = await adapter.selectAccount(
    {
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      expiresAt: stored.expiresAt ? new Date(stored.expiresAt) : null,
    },
    externalId,
  );
  assertConnectable(selected.account);
  if (selected.account.externalId !== externalId) {
    throw new ValidationError("The provider returned a different account from the one chosen.");
  }

  const account = await connectAccount(actor, {
    clientId: row.clientId,
    provider: row.provider,
    account: selected.account,
    credentials: selected.credentials,
  });

  // Used once. Keeping it would let the same grant connect a second Page to
  // the same client later without anybody signing in again.
  await db.socialPendingConnection.deleteMany({ where: { id } });
  return { account, returnTo: row.returnTo };
}

export async function cancelPendingConnection(actor: Actor, id: string, now = new Date()) {
  const row = await authorised(actor, id, now);
  await db.socialPendingConnection.deleteMany({ where: { id } });
  return { returnTo: row.returnTo };
}
