"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, ExternalLink, RotateCw, Send, X } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Dialog,
  Field,
  Input,
  Select,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useHydrated } from "@/lib/utils/hydrated";
import { PROVIDER_LABEL, POST_STATUS_TONE, POST_STATUS_LABEL } from "@/lib/social/capabilities";
import {
  resolveStrandedAction,
  retryAllFailedAction,
  retryPostAction,
  unscheduleAction,
} from "./actions";
import type { SocialPostStatus, SocialProvider } from "@/generated/prisma/enums";

/**
 * The queue, as something to work rather than read.
 *
 * Ordered by how much a person is needed: stranded first, because those are
 * blocked on a human decision and nothing else will move them; then failures
 * out of retries; then the rest, which are progressing on their own.
 */

export type QueueCard = {
  id: string;
  clientId: string;
  clientName: string;
  itemId: string;
  title: string;
  provider: SocialProvider;
  status: SocialPostStatus;
  campaign: string | null;
  accountName: string | null;
  scheduledFor: string | null;
  publishedAt: string | null;
  lastAttemptAt: string | null;
  attemptCount: number;
  externalUrl: string | null;
  lastError: string | null;
};

export type QueueBands = {
  stranded: QueueCard[];
  needsRetry: QueueCard[];
  retrying: QueueCard[];
  inFlight: QueueCard[];
  due: QueueCard[];
  upcoming: QueueCard[];
  recent: QueueCard[];
};

const WHEN = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

const when = (value: string | null) => (value ? WHEN.format(new Date(value)) : null);

export function QueueBoard({
  bands,
  clients,
  providers,
  activeClient,
  activeProvider,
  canPublish,
  zone,
}: {
  bands: QueueBands;
  clients: { id: string; name: string }[];
  providers: SocialProvider[];
  activeClient: string | null;
  activeProvider: string | null;
  canPublish: boolean;
  zone: string;
}) {
  const router = useRouter();
  const ready = useHydrated();
  const { push } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [stranded, setStranded] = React.useState<QueueCard | null>(null);

  const filter = (next: { client?: string | null; provider?: string | null }) => {
    const query = new URLSearchParams();
    const client = next.client === undefined ? activeClient : next.client;
    const provider = next.provider === undefined ? activeProvider : next.provider;
    if (client) query.set("clientId", client);
    if (provider) query.set("provider", provider);
    const suffix = query.toString();
    router.push((suffix ? `/admin/social/queue?${suffix}` : "/admin/social/queue") as Route);
  };

  const run = async (work: () => Promise<{ ok: boolean; message?: string }>, done: string) => {
    setBusy(true);
    const result = await work();
    setBusy(false);
    if (result.ok) {
      push({ tone: "success", title: done });
      router.refresh();
    } else {
      push({ tone: "error", title: result.message ?? "That did not work." });
    }
  };

  const failedCount = bands.needsRetry.length + bands.retrying.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
            Client
          </span>
          <Select
            className="w-56"
            value={activeClient ?? ""}
            onChange={(event) => filter({ client: event.target.value || null })}
          >
            <option value="">Every client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
            Platform
          </span>
          <Select
            className="w-44"
            value={activeProvider ?? ""}
            onChange={(event) => filter({ provider: event.target.value || null })}
          >
            <option value="">Every platform</option>
            {providers.map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDER_LABEL[provider]}
              </option>
            ))}
          </Select>
        </label>

        {canPublish && failedCount > 0 ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              const result = await retryAllFailedAction({
                clientId: activeClient,
                provider: activeProvider,
              });
              setBusy(false);
              if (!result.ok) {
                push({ tone: "error", title: result.message });
                return;
              }
              const { published, failed, notAttempted } = result.data;
              // Say exactly what happened. "Retried every failure" was true only
              // when every one of them happened to work.
              push({
                tone: failed > 0 ? "info" : "success",
                title: [
                  `${published} posted`,
                  failed > 0 ? `${failed} still failing` : null,
                  notAttempted > 0 ? `${notAttempted} left for later (rate limit)` : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
              });
              router.refresh();
            }}
          >
            <RotateCw size={14} aria-hidden="true" />
            Retry all {failedCount}
          </Button>
        ) : null}

        <p className="ml-auto text-2xs text-ink-subtle">Times in {zone}</p>
      </div>

      <Band
        title="Needs checking"
        tone="danger"
        description="These may already be live. A publication was cut off, or the platform failed in a way that means it may have the post anyway — so nothing is sent again until someone looks."
        cards={bands.stranded}
        empty={null}
        render={(card) => (
          <Row
            card={card}
            action={
              canPublish ? (
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setStranded(card)}>
                  Say what happened
                </Button>
              ) : null
            }
          />
        )}
      />

      <Band
        title="Failed — out of automatic retries"
        tone="danger"
        description="The scheduler has stopped trying. Fix the cause, then retry."
        cards={bands.needsRetry}
        empty={null}
        render={(card) => (
          <Row
            card={card}
            action={
              canPublish ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => run(() => retryPostAction({ postId: card.id }), "Retried.")}
                >
                  <RotateCw size={13} aria-hidden="true" />
                  Retry
                </Button>
              ) : null
            }
          />
        )}
      />

      <Band
        title="Failed — will retry itself"
        tone="warning"
        description="The scheduler will try these again on its next run."
        cards={bands.retrying}
        empty={null}
        render={(card) => <Row card={card} action={null} />}
      />

      <Band
        title="Publishing now"
        tone="neutral"
        description={null}
        cards={bands.inFlight}
        empty={null}
        render={(card) => <Row card={card} action={null} />}
      />

      <Band
        title="Due"
        tone="neutral"
        description="Waiting only for the next scheduler run."
        cards={bands.due}
        empty="Nothing is waiting to go out."
        render={(card) => (
          <Row
            card={card}
            action={
              canPublish ? (
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => run(() => retryPostAction({ postId: card.id }), "Posted.")}
                  >
                    <Send size={13} aria-hidden="true" />
                    Publish now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      run(() => unscheduleAction({ postId: card.id }), "Back to draft.")
                    }
                  >
                    <X size={13} aria-hidden="true" />
                  </Button>
                </div>
              ) : null
            }
          />
        )}
      />

      <Band
        title="Scheduled"
        tone="neutral"
        description={null}
        cards={bands.upcoming}
        empty="Nothing is scheduled."
        render={(card) => <Row card={card} action={null} />}
      />

      <Band
        title="Published this week"
        tone="success"
        description={null}
        cards={bands.recent}
        empty={null}
        render={(card) => <Row card={card} action={null} />}
      />

      {stranded ? (
        <StrandedDialog
          card={stranded}
          busy={busy}
          onClose={() => setStranded(null)}
          onResolve={async (outcome, externalUrl) => {
            setStranded(null);
            await run(
              () => resolveStrandedAction({ postId: stranded.id, outcome, externalUrl }),
              outcome === "published" ? "Recorded as published." : "Put back in the queue.",
            );
          }}
        />
      ) : null}
    </div>
  );
}

function Band({
  title,
  tone,
  description,
  cards,
  empty,
  render,
}: {
  title: string;
  tone: "danger" | "warning" | "neutral" | "success";
  description: string | null;
  cards: QueueCard[];
  /** Shown when there is nothing. Null hides the band entirely. */
  empty: string | null;
  render: (card: QueueCard) => React.ReactNode;
}) {
  if (cards.length === 0 && empty === null) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              {tone === "danger" ? (
                <AlertTriangle size={15} className="text-brand-red" aria-hidden="true" />
              ) : null}
              {title}
            </span>
          </CardTitle>
          <span className="text-xs tabular-nums text-ink-subtle">{cards.length}</span>
        </div>
        {description ? <p className="mt-1 text-2xs text-ink-subtle">{description}</p> : null}
      </CardHeader>
      <CardBody>
        {cards.length === 0 ? (
          <p className="py-4 text-center text-xs text-ink-subtle">{empty}</p>
        ) : (
          <ul className="divide-y divide-line">{cards.map((card) => <li key={card.id} className="py-2.5 first:pt-0 last:pb-0">{render(card)}</li>)}</ul>
        )}
      </CardBody>
    </Card>
  );
}

function Row({ card, action }: { card: QueueCard; action: React.ReactNode }) {
  const at = when(card.publishedAt ?? card.scheduledFor);

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-sm bg-navy-800 px-1.5 py-px text-[10px] font-semibold uppercase leading-4 tracking-wide text-white">
            {PROVIDER_LABEL[card.provider]}
          </span>
          <Link
            href={`/admin/clients/${card.clientId}/social/content/${card.itemId}` as Route}
            className="truncate text-sm text-navy-800 hover:text-brand-red-text"
          >
            {card.title}
          </Link>
          <Badge tone={POST_STATUS_TONE[card.status]}>{POST_STATUS_LABEL[card.status]}</Badge>
        </div>
        <p className="mt-1 text-2xs text-ink-subtle">
          {[
            card.clientName,
            card.campaign,
            card.accountName,
            at,
            card.attemptCount > 0
              ? `${card.attemptCount} attempt${card.attemptCount === 1 ? "" : "s"}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {card.lastError ? (
          <p className="mt-1 flex items-start gap-1 text-2xs text-brand-red-text">
            <AlertCircle size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
            {card.lastError}
          </p>
        ) : null}
        {card.externalUrl ? (
          <a
            href={card.externalUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1 inline-flex items-center gap-1 text-2xs text-ink-subtle hover:text-navy-800"
          >
            <ExternalLink size={11} aria-hidden="true" />
            View it
          </a>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * The one place a person tells the system something it could not observe.
 *
 * Both answers are offered plainly, with no default and no recommended one:
 * the system genuinely does not know, and nudging towards either would be
 * inventing an opinion it has not earned.
 */
function StrandedDialog({
  card,
  busy,
  onClose,
  onResolve,
}: {
  card: QueueCard;
  busy: boolean;
  onClose: () => void;
  onResolve: (outcome: "published" | "not-published", externalUrl: string | null) => void;
}) {
  const [url, setUrl] = React.useState("");

  return (
    <Dialog
      open
      onClose={onClose}
      title="What happened to this post?"
      description={`A publication to ${PROVIDER_LABEL[card.provider]} was interrupted. Open the account, look for "${card.title}", and tell us what you find.`}
    >
      <div className="space-y-4">
        <div className="rounded-md border border-line bg-surface-muted p-3">
          <p className="text-xs font-medium text-navy-800">It is on the platform</p>
          <p className="mt-1 text-2xs text-ink-subtle">
            We will record it as published and never try again. Paste the link if you have it.
          </p>
          <Field id="externalUrl" label="Link to the post" hint="Optional.">
            {(aria) => (
              <Input
                {...aria}
                value={url}
                placeholder="https://"
                onChange={(event) => setUrl(event.target.value)}
              />
            )}
          </Field>
          <Button
            size="sm"
            className="mt-2"
            disabled={busy}
            onClick={() => onResolve("published", url.trim() || null)}
          >
            It went out
          </Button>
        </div>

        <div className="rounded-md border border-line bg-surface-muted p-3">
          <p className="text-xs font-medium text-navy-800">It is not there</p>
          <p className="mt-1 text-2xs text-ink-subtle">
            It goes back in the queue as a failure, ready to retry.
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={busy}
            onClick={() => onResolve("not-published", null)}
          >
            It did not go out
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
