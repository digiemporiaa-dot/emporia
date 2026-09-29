import type { Metadata, Route } from "next";
import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { requireActorPage } from "@/lib/actor";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { getPendingConnection, type PendingConnectionView } from "@/lib/services/social-pending.service";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { isAppError } from "@/lib/errors";
import { cancelChoiceAction, chooseAccountAction } from "./actions";

export const metadata: Metadata = { title: "Choose an account" };
export const dynamic = "force-dynamic";

/**
 * Which of the sign-in's accounts this client means.
 *
 * A Server Component with plain form posts: there is nothing here that needs
 * client-side state, and nothing sensitive either — the service hands over
 * names and handles, never a token.
 */

const ERRORS: Record<string, string> = {
  pick: "Choose one of the accounts first.",
  failed: "The provider refused that account. Try again, or choose another.",
};

export default async function ChooseAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string; pendingId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { clientId, pendingId } = await params;
  const { error } = await searchParams;
  const actor = await requireActorPage(
    `/admin/clients/${clientId}/social/accounts/choose/${pendingId}`,
  );
  const back = `/admin/clients/${clientId}/social/accounts` as Route;

  let pending: PendingConnectionView;
  try {
    pending = await getPendingConnection(actor, pendingId);
  } catch (failure) {
    if (isAppError(failure) && (failure.code === "NOT_FOUND" || failure.code === "FORBIDDEN")) {
      return (
        <Card className="max-w-xl">
          <CardBody>
            <p className="text-sm text-navy-800">
              This connection has expired or was started by someone else.
            </p>
            <p className="mt-1 text-xs text-ink-subtle">
              A sign-in waits here for fifteen minutes. Start again from the accounts page.
            </p>
            <Link href={back} className="mt-4 inline-block text-sm text-brand-red underline underline-offset-4">
              Back to social accounts
            </Link>
          </CardBody>
        </Card>
      );
    }
    throw failure;
  }

  // The URL named a client; the grant names one too. They must agree, or the
  // form would post one client's id beside another client's grant.
  if (pending.clientId !== clientId) {
    return (
      <Card className="max-w-xl">
        <CardBody>
          <p className="text-sm text-navy-800">This connection belongs to a different client.</p>
          <Link href={back} className="mt-4 inline-block text-sm text-brand-red underline underline-offset-4">
            Back to social accounts
          </Link>
        </CardBody>
      </Card>
    );
  }

  const label = PROVIDER_LABEL[pending.provider];
  const message = error ? ERRORS[error] : undefined;

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">Connect {label}</p>
        {/* The social layout owns the page's h1. */}
        <h2 className="mt-1.5 text-xl text-navy-800">Which account is this client&apos;s?</h2>
        <p className="mt-1 text-sm text-ink-muted">
          That sign-in manages {pending.options.length} accounts. Posts for this client will go out
          from the one you choose.
        </p>
      </div>

      {message ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
        >
          <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{message}</span>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{label} accounts</CardTitle>
        </CardHeader>
        <CardBody>
          <form action={chooseAccountAction}>
            <input type="hidden" name="pendingId" value={pending.id} />
            <input type="hidden" name="clientId" value={clientId} />
            <fieldset>
              <legend className="sr-only">Choose one {label} account</legend>
              <ul className="divide-y divide-line">
                {pending.options.map((option) => {
                  const id = `option-${option.externalId}`;
                  return (
                    <li key={option.externalId} className="py-3 first:pt-0">
                      <label
                        htmlFor={id}
                        className={
                          option.connectedElsewhere
                            ? "flex cursor-not-allowed items-center gap-3 opacity-60"
                            : "flex cursor-pointer items-center gap-3"
                        }
                      >
                        <input
                          id={id}
                          type="radio"
                          name="externalId"
                          value={option.externalId}
                          disabled={option.connectedElsewhere}
                          className="size-4 accent-brand-red"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-navy-800">{option.name}</span>
                          <span className="block text-xs text-ink-subtle">
                            {option.username ? `@${option.username}` : option.externalId}
                          </span>
                        </span>
                        {option.connectedHere ? <Badge tone="success">Already connected here</Badge> : null}
                        {option.connectedElsewhere ? (
                          <Badge tone="neutral">Connected to another client</Badge>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button type="submit">Connect this account</Button>
            </div>
          </form>
          <form action={cancelChoiceAction} className="mt-2">
            <input type="hidden" name="pendingId" value={pending.id} />
            <input type="hidden" name="clientId" value={clientId} />
            <Button type="submit" variant="ghost" size="sm">
              Cancel
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
