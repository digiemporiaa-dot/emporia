"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Link2, RefreshCw, TriangleAlert, Unlink } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Dialog,
  useToast,
} from "@/components/ui";
import { useHydrated } from "@/lib/utils/hydrated";
import type { SocialAccountStatus, SocialProvider } from "@/generated/prisma/enums";
import type { AccountHealth } from "@/lib/services/social-account.service";
import { disconnectAccountAction, syncAccountAction } from "./actions";

export type AccountRow = {
  id: string;
  provider: SocialProvider;
  name: string;
  username: string | null;
  profileUrl: string | null;
  status: SocialAccountStatus;
  health: AccountHealth;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  tokenExpiresAt: string | null;
  scopes: readonly string[];
  connectedBy: string | null;
};

export type ProviderRow = {
  provider: SocialProvider;
  label: string;
  configured: boolean;
  implemented: boolean;
  connected: boolean;
  formats: number;
};

const HEALTH: Record<AccountHealth, { label: string; tone: "success" | "warning" | "red" | "neutral" }> = {
  HEALTHY: { label: "Connected", tone: "success" },
  EXPIRING: { label: "Expiring soon", tone: "warning" },
  ATTENTION: { label: "Needs attention", tone: "warning" },
  DISCONNECTED: { label: "Disconnected", tone: "neutral" },
};

/** What came back from the OAuth round trip, in words rather than a code. */
const OUTCOME: Record<string, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "Account connected." },
  cancelled: { tone: "error", text: "That connection was cancelled before it finished." },
  failed: {
    tone: "error",
    text: "The provider refused the connection. Check the app credentials in Settings and try again.",
  },
  unconfigured: {
    tone: "error",
    text: "That provider is not configured yet. Add its app credentials in Settings first.",
  },
  expired: {
    tone: "error",
    text: "That sign-in waited too long and has expired. Connect again.",
  },
  "no-accounts": {
    tone: "error",
    text: "That sign-in does not manage any account that can be connected. Check it has admin access to the Page.",
  },
  "already-connected": {
    tone: "error",
    text: "That account is already connected to another client.",
  },
};

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function AccountsPanel({
  clientId,
  accounts,
  providers,
  canManage,
}: {
  clientId: string;
  accounts: readonly AccountRow[];
  providers: readonly ProviderRow[];
  canManage: boolean;
}) {
  const ready = useHydrated();
  const router = useRouter();
  const search = useSearchParams();
  const { push } = useToast();
  const [pending, start] = React.useTransition();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState<AccountRow | null>(null);

  const outcome = OUTCOME[search.get("connection") ?? ""];

  const sync = (account: AccountRow) => {
    setBusy(account.id);
    start(async () => {
      const result = await syncAccountAction({ accountId: account.id, clientId });
      setBusy(null);
      if (!result.ok) {
        push({ tone: "error", title: "That did not work.", description: result.message });
        return;
      }
      if (result.data.synced) {
        push({ tone: "success", title: "Account is healthy." });
      } else {
        // The reason is on the card now, so the toast stays short.
        push({ tone: "error", title: "The provider refused.", description: result.data.message ?? "" });
      }
      router.refresh();
    });
  };

  const disconnect = (account: AccountRow) => {
    setBusy(account.id);
    start(async () => {
      const result = await disconnectAccountAction({ accountId: account.id, clientId });
      setBusy(null);
      setConfirmDisconnect(null);
      if (result.ok) {
        push({ tone: "success", title: `${account.name} disconnected.` });
        router.refresh();
      } else {
        push({ tone: "error", title: "That did not work.", description: result.message });
      }
    });
  };

  const live = accounts.filter((a) => a.status !== "DISCONNECTED");
  const past = accounts.filter((a) => a.status === "DISCONNECTED");

  return (
    <div className="space-y-6">
      {outcome ? (
        <p
          role={outcome.tone === "success" ? "status" : "alert"}
          className={
            outcome.tone === "success"
              ? "flex items-start gap-2 rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
              : "flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
          }
        >
          {outcome.tone === "success" ? (
            <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          ) : (
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          )}
          <span>{outcome.text}</span>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Connected accounts</CardTitle>
          <p className="text-xs text-ink-subtle">
            Posts go out from these. An account that needs attention will not publish until it is
            reconnected.
          </p>
        </CardHeader>
        <CardBody>
          {live.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong px-4 py-10 text-center text-sm text-ink-subtle">
              Nothing connected yet. Connect an account below to start scheduling.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {live.map((account) => (
                <li key={account.id} className="flex flex-wrap items-start gap-4 py-4 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-navy-800">{account.name}</span>
                      <Badge tone={HEALTH[account.health].tone}>{HEALTH[account.health].label}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {account.username ? `@${account.username} · ` : ""}
                      Last checked {when(account.lastSyncedAt)}
                      {account.connectedBy ? ` · connected by ${account.connectedBy}` : ""}
                    </p>
                    {account.lastSyncError ? (
                      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-brand-red-text">
                        <TriangleAlert size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
                        {account.lastSyncError}
                      </p>
                    ) : null}
                    {account.health === "EXPIRING" ? (
                      <p className="mt-1.5 text-xs text-warning">
                        Access expires {when(account.tokenExpiresAt)}. Reconnect before then to
                        avoid a gap.
                      </p>
                    ) : null}
                  </div>

                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!ready || pending}
                        onClick={() => sync(account)}
                      >
                        <RefreshCw size={13} aria-hidden="true" />
                        {busy === account.id && pending ? "Checking…" : "Sync now"}
                      </Button>
                      <a
                        href={`/api/social/oauth/${account.provider.toLowerCase()}?clientId=${clientId}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-white px-3 text-xs text-navy-800 hover:border-navy-300 hover:bg-surface-muted"
                      >
                        <Link2 size={13} aria-hidden="true" />
                        Reconnect
                      </a>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={!ready || pending}
                        onClick={() => setConfirmDisconnect(account)}
                      >
                        <Unlink size={13} aria-hidden="true" />
                        Disconnect
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Available platforms</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="grid gap-2 sm:grid-cols-2">
            {providers.map((provider) => (
              <li
                key={provider.provider}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3.5 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-navy-800">{provider.label}</p>
                  <p className="mt-0.5 text-2xs text-ink-subtle">
                    {/* Three different states, said plainly rather than one dead
                        button. An operator can act on two of them. */}
                    {provider.connected
                      ? "Connected for this client"
                      : !provider.implemented
                        ? "Not available yet"
                        : !provider.configured
                          ? "Not configured — add app credentials in Settings"
                          : `${provider.formats} formats supported`}
                  </p>
                </div>
                {canManage && provider.implemented && provider.configured && !provider.connected ? (
                  <a
                    href={`/api/social/oauth/${provider.provider.toLowerCase()}?clientId=${clientId}`}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-brand-red px-3 text-xs text-white hover:bg-red-600"
                  >
                    <Link2 size={13} aria-hidden="true" />
                    Connect
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {past.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Previously connected</CardTitle>
            <p className="text-xs text-ink-subtle">
              Kept because the posts that went out through them are still this client&rsquo;s
              record.
            </p>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-line">
              {past.map((account) => (
                <li key={account.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm text-ink-muted">{account.name}</span>
                  <Badge tone="neutral">Disconnected</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      {confirmDisconnect ? (
        <Dialog
          open
          onClose={() => setConfirmDisconnect(null)}
          title={`Disconnect ${confirmDisconnect.name}?`}
          description="Scheduled posts for this account will stop going out. Published posts and their history are kept."
        >
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDisconnect(null)}>
              Keep it
            </Button>
            <Button variant="danger" disabled={pending} onClick={() => disconnect(confirmDisconnect)}>
              Disconnect
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
