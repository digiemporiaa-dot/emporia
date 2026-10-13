import type { Metadata } from "next";
import { z } from "zod";
import { AlertCircle, CheckCircle2, ExternalLink, Link2 } from "lucide-react";
import { requirePortalActorPage } from "@/lib/actor/portal";
import { portalSocialAccounts, type ClientAccountState } from "@/lib/services/portal-social.service";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import type { SocialProvider } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Social accounts" };
export const dynamic = "force-dynamic";

/**
 * The client connects their own social accounts.
 *
 * Connect and Reconnect only — disconnecting, moving and checking stay with
 * the agency. Both are plain links to the sign-in route, which takes the
 * client from the session, so this page needs no client JavaScript and passes
 * no client id anywhere.
 */

const OUTCOME: Record<string, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "Account connected. Your team has been told." },
  cancelled: { tone: "error", text: "That connection was cancelled before it finished." },
  failed: { tone: "error", text: "The platform did not accept that connection. Try again, or ask your team for help." },
  unconfigured: { tone: "error", text: "That platform is not available to connect yet. Ask your team." },
  expired: { tone: "error", text: "That sign-in waited too long and has expired. Connect again." },
  "no-accounts": {
    tone: "error",
    text: "That sign-in does not manage an account that can be connected. Sign in with the profile that is an admin of the page.",
  },
  "already-connected": {
    tone: "error",
    text: "That account is already linked elsewhere with us. Ask your team to move it to you, then connect it again.",
  },
};

const STATE: Record<ClientAccountState, { label: string; tone: "success" | "warning" | "neutral" }> = {
  CONNECTED: { label: "Connected", tone: "success" },
  NEEDS_RECONNECT: { label: "Needs reconnecting", tone: "warning" },
  NOT_CONNECTED: { label: "Not connected", tone: "neutral" },
};

const search = z.object({ connection: z.string().max(40).optional().catch(undefined) });

const connectHref = (provider: SocialProvider) => `/api/social/oauth/${provider.toLowerCase()}`;

const LINK =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red";

export default async function PortalSocialAccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePortalActorPage();
  const { connection } = search.parse(await searchParams);
  const outcome = connection ? OUTCOME[connection] : undefined;
  const { accounts, available } = await portalSocialAccounts(actor);
  const toConnect = available.filter((p) => !p.connected);

  return (
    <div className="space-y-5">
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
          <CardTitle>Your accounts</CardTitle>
          <p className="text-xs text-ink-subtle">
            We publish your approved posts from these. You sign in on the platform itself; we never
            see your password.
          </p>
        </CardHeader>
        <CardBody>
          {accounts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-sm text-ink-subtle">
              No accounts connected yet. Connect one below.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {accounts.map((account) => (
                <li key={account.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-navy-800">{account.name}</span>
                      <Badge tone={STATE[account.state].tone}>{STATE[account.state].label}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-subtle">
                      {PROVIDER_LABEL[account.provider]}
                      {account.username ? ` · @${account.username}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {account.profileUrl ? (
                      <a
                        href={account.profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${LINK} border border-line-strong bg-white text-navy-800 hover:border-navy-300`}
                      >
                        <ExternalLink size={13} aria-hidden="true" />
                        View<span className="sr-only"> {account.name} (opens in a new tab)</span>
                      </a>
                    ) : null}
                    {account.state !== "CONNECTED" && account.canReconnect ? (
                      <a href={connectHref(account.provider)} className={`${LINK} bg-brand-red text-white hover:bg-red-600`}>
                        <Link2 size={13} aria-hidden="true" />
                        Reconnect<span className="sr-only"> {account.name}</span>
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connect a platform</CardTitle>
          <p className="text-xs text-ink-subtle">
            Sign in with the profile that manages your business page. For Instagram, that is a
            Business or Creator account.
          </p>
        </CardHeader>
        <CardBody>
          {toConnect.length === 0 ? (
            <p className="text-sm text-ink-subtle">
              {available.length === 0
                ? "There is nothing to connect yet. Your team will let you know when there is."
                : "Every platform we offer is connected."}
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {toConnect.map((platform) => (
                <li
                  key={platform.provider}
                  className="flex items-center justify-between gap-3 rounded-md border border-line px-3.5 py-3"
                >
                  <span className="text-sm text-navy-800">{platform.label}</span>
                  <a href={connectHref(platform.provider)} className={`${LINK} bg-brand-red text-white hover:bg-red-600`}>
                    <Link2 size={13} aria-hidden="true" />
                    Connect<span className="sr-only"> {platform.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
