"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, Copy, Check } from "lucide-react";
import { Badge, Button, Field, Input, Select, Textarea } from "@/components/ui";
import {
  invitePortalUserAction,
  replyToClientAction,
  revokePortalUserAction,
  type InviteActionState,
  type ReplyActionState,
} from "../actions";
import type { UserStatus } from "@/generated/prisma/enums";

/** Portal access and the client message thread, from the agency's side. */

const DATE = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red">
      <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      {message}
    </p>
  );
}

export function PortalAccessPanel({
  clientId,
  users,
  canInvite,
  canRevoke,
}: {
  clientId: string;
  users: readonly {
    id: string;
    name: string;
    email: string;
    status: UserStatus;
    lastLoginAt: Date | null;
    inviteExpires: Date | null;
  }[];
  canInvite: boolean;
  canRevoke: boolean;
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<InviteActionState, FormData>(
    invitePortalUserAction,
    null,
  );
  const [pending, start] = useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const revoke = (userId: string) => {
    setError(null);
    start(async () => {
      const result = await revokePortalUserAction(userId, clientId);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {users.length === 0 ? (
        <p className="text-xs text-ink-subtle">No one from this client can sign in yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {users.map((user) => (
            <li key={user.id} className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-navy-800">{user.name}</p>
                <p className="truncate text-2xs text-ink-subtle">{user.email}</p>
                <p className="text-2xs text-ink-subtle">
                  {user.lastLoginAt
                    ? `last signed in ${DATE.format(user.lastLoginAt)}`
                    : user.inviteExpires
                      ? `invited, expires ${DATE.format(user.inviteExpires)}`
                      : "never signed in"}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-2">
                <Badge
                  tone={
                    user.status === "ACTIVE"
                      ? "success"
                      : user.status === "INVITED"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {user.status.toLowerCase()}
                </Badge>
                {canRevoke && user.status !== "SUSPENDED" ? (
                  <button
                    type="button"
                    onClick={() => revoke(user.id)}
                    disabled={pending}
                    className="rounded-sm border border-line px-1.5 py-1 text-2xs text-ink-muted hover:border-brand-red hover:text-brand-red"
                  >
                    Revoke
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Problem message={error} />

      {canInvite ? (
        <form action={formAction} className="space-y-3 border-t border-line pt-3" noValidate>
          <input type="hidden" name="clientId" value={clientId} />

          <Field id="invite-name" label="Name" required>
            {(aria) => <Input {...aria} name="name" required />}
          </Field>
          <Field id="invite-email" label="Email" required>
            {(aria) => <Input {...aria} name="email" type="email" required />}
          </Field>

          {state && !state.ok ? <Problem message={state.message} /> : null}

          {state?.ok ? (
            <div className="space-y-1.5 rounded-md border border-success/30 bg-success-bg p-2.5">
              <p className="text-2xs text-success">
                Invitation created. Email is not wired up until phase 12 — send this link yourself.
                It expires {DATE.format(new Date(state.data.expiresAt))}.
              </p>
              <div className="flex items-center gap-1.5">
                <input
                  readOnly
                  aria-label="Invitation link"
                  value={state.data.inviteUrl}
                  className="h-8 min-w-0 flex-1 rounded-sm border border-line bg-white px-2 font-mono text-2xs text-ink"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(state.data.inviteUrl);
                    setCopied(true);
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded-sm border border-line-strong px-2 text-2xs text-navy-800 hover:border-brand-red hover:text-brand-red"
                >
                  {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ) : null}

          <Submit label="Create invitation" />
        </form>
      ) : null}
    </div>
  );
}

export function ClientThread({
  clientId,
  messages,
  projects,
  canReply,
}: {
  clientId: string;
  messages: readonly {
    id: string;
    body: string;
    fromClient: boolean;
    createdAt: Date;
    author: { id: string; name: string };
    project: { id: string; code: string; name: string } | null;
  }[];
  projects: readonly { id: string; name: string }[];
  canReply: boolean;
}) {
  const [state, formAction] = useActionState<ReplyActionState, FormData>(
    replyToClientAction,
    null,
  );
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <div className="space-y-4">
      {messages.length === 0 ? (
        <p className="text-xs text-ink-subtle">Nothing has been said yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {messages.map((message) => (
            <li
              key={message.id}
              className={message.fromClient ? "flex justify-start" : "flex justify-end"}
            >
              <div
                className={`max-w-prose rounded-lg px-3 py-2 ${
                  message.fromClient
                    ? "border border-line bg-surface-muted text-ink"
                    : "bg-navy-800 text-white"
                }`}
              >
                <p className="whitespace-pre-wrap text-xs">{message.body}</p>
                <p
                  className={`mt-1 text-2xs ${
                    message.fromClient ? "text-ink-subtle" : "text-navy-100"
                  }`}
                >
                  {message.author.name} · {DATE.format(message.createdAt)}
                  {message.project ? ` · ${message.project.name}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canReply ? (
        <form ref={formRef} action={formAction} className="space-y-2 border-t border-line pt-3" noValidate>
          <input type="hidden" name="clientId" value={clientId} />
          <label htmlFor="reply-body" className="sr-only">
            Reply to the client
          </label>
          <Textarea id="reply-body" name="body" rows={3} placeholder="Reply to the client" />

          {projects.length > 0 ? (
            <div className="flex items-center gap-2">
              <label htmlFor="reply-project" className="text-2xs uppercase tracking-wide text-ink-subtle">
                About
              </label>
              <Select id="reply-project" name="projectId" defaultValue="" className="max-w-xs">
                <option value="">Anything</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          {state && !state.ok ? <Problem message={state.message} /> : null}

          <Submit label="Send reply" />
        </form>
      ) : null}
    </div>
  );
}
