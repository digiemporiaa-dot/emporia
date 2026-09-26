"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, Copy } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  useToast,
} from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import type { SocialProvider } from "@/generated/prisma/enums";
import { clearSocialProviderAction, saveSocialProviderAction } from "./actions";

export type ProviderSettingsView = {
  provider: SocialProvider;
  label: string;
  isEnabled: boolean;
  clientId: string | null;
  clientSecretMasked: string | null;
  clientSecretUnreadable: boolean;
  implemented: boolean;
  redirectUri: string;
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function SocialProviderSettings({
  providers,
  canEdit,
}: {
  providers: readonly ProviderSettingsView[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-4">
      {providers.map((provider) => (
        <ProviderCard key={provider.provider} provider={provider} canEdit={canEdit} />
      ))}
    </div>
  );
}

function ProviderCard({
  provider,
  canEdit,
}: {
  provider: ProviderSettingsView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = React.useTransition();
  const [state, formAction] = useActionState<ActionResult<{ provider: string }> | null, FormData>(
    saveSocialProviderAction,
    null,
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(provider.redirectUri);
      push({ tone: "success", title: "Redirect URI copied." });
    } catch {
      // Clipboard access can be refused; the value is on screen to select.
      push({ tone: "error", title: "Copy it from the field instead." });
    }
  };

  const clear = () => {
    start(async () => {
      const result = await clearSocialProviderAction({ provider: provider.provider });
      if (result.ok) {
        push({ tone: "success", title: `${provider.label} credentials removed.` });
        router.refresh();
      } else {
        push({ tone: "error", title: "That did not work.", description: result.message });
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{provider.label}</CardTitle>
          {!provider.implemented ? (
            // Distinguished from "not configured": entering credentials would
            // not help, because the adapter does not exist yet.
            <Badge tone="neutral">Not available yet</Badge>
          ) : provider.clientId ? (
            <Badge tone={provider.isEnabled ? "success" : "warning"}>
              {provider.isEnabled ? "Enabled" : "Saved, switched off"}
            </Badge>
          ) : (
            <Badge tone="neutral">Not configured</Badge>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {!provider.implemented ? (
          <p className="text-xs text-ink-subtle">
            Emporia does not talk to {provider.label} yet. Its credentials can be added once the
            integration ships.
          </p>
        ) : (
          <form action={formAction} className="space-y-4" noValidate>
            <input type="hidden" name="provider" value={provider.provider} />

            {state && !state.ok ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
              >
                <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>{state.message}</span>
              </p>
            ) : null}
            {state?.ok ? (
              <p
                role="status"
                className="rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
              >
                Saved.
              </p>
            ) : null}

            {provider.clientSecretUnreadable ? (
              <p className="rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-xs text-brand-red-text">
                The stored secret can no longer be read — <code>AUTH_SECRET</code> has changed
                since it was saved. Enter it again.
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id={`${provider.provider}-clientId`} label="Client id">
                {(aria) => (
                  <Input
                    {...aria}
                    name="clientId"
                    defaultValue={provider.clientId ?? ""}
                    disabled={!canEdit}
                    autoComplete="off"
                  />
                )}
              </Field>

              <Field
                id={`${provider.provider}-clientSecret`}
                label="Client secret"
                hint={
                  provider.clientSecretMasked
                    ? `Stored: ${provider.clientSecretMasked}. Leave blank to keep it.`
                    : "Stored encrypted. It is never shown again."
                }
              >
                {(aria) => (
                  <Input
                    {...aria}
                    name="clientSecret"
                    type="password"
                    placeholder={provider.clientSecretMasked ? "Unchanged" : ""}
                    disabled={!canEdit}
                    autoComplete="new-password"
                  />
                )}
              </Field>
            </div>

            <div>
              <span className="mb-1.5 block text-2xs font-medium uppercase tracking-wide text-ink-subtle">
                Redirect URI
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface-muted px-3 py-2 font-mono text-xs text-navy-800">
                  {provider.redirectUri}
                </code>
                <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}>
                  <Copy size={13} aria-hidden="true" />
                  Copy
                </Button>
              </div>
              <p className="mt-1 text-xs text-ink-subtle">
                Register this exactly, in the platform&rsquo;s app settings. A mismatch here is the
                usual reason a connection fails.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-navy-800">
              <input
                type="checkbox"
                name="isEnabled"
                defaultChecked={provider.isEnabled}
                disabled={!canEdit}
                className="size-4 rounded-xs border-line-strong text-brand-red"
              />
              Offer {provider.label} connections to clients
            </label>

            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2">
                <Submit />
                {provider.clientId ? (
                  <Button type="button" size="sm" variant="danger" disabled={pending} onClick={clear}>
                    Remove credentials
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-ink-subtle">
                You do not have permission to change how the system is configured.
              </p>
            )}
          </form>
        )}
      </CardBody>
    </Card>
  );
}
