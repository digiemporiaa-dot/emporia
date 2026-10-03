"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle, Send, PlugZap, Save, TriangleAlert } from "lucide-react";
import { Button, Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle, Field, Input, Select, useToast } from "@/components/ui";
import { SMTP_ENCRYPTION_LABEL, SMTP_ENCRYPTIONS, type SmtpEncryption } from "@/lib/email/smtp-settings";
import type { SafeEmailSettings } from "@/lib/services/email-settings.service";
import { saveSmtpSettingsAction, sendSmtpTestAction, verifySmtpAction } from "./actions";

/**
 * Settings → Email: the SMTP server, who hears about new activity, and a test
 * send. The password is write-only — the page only ever knows whether one is
 * stored — and blank on save means "keep it".
 */

type Values = {
  host: string;
  port: string;
  username: string;
  password: string;
  removePassword: boolean;
  encryption: SmtpEncryption;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  enabled: boolean;
  salesAddresses: string;
  notifyLeadCreated: boolean;
  notifyLeadAssigned: boolean;
  notifyFormSubmission: boolean;
};

function fromSettings(s: SafeEmailSettings): Values {
  return {
    host: s.host ?? "",
    port: String(s.port),
    username: s.username ?? "",
    password: "",
    removePassword: false,
    encryption: s.encryption,
    fromName: s.fromName,
    fromAddress: s.fromAddress ?? "",
    replyTo: s.replyTo ?? "",
    enabled: s.enabled,
    salesAddresses: s.salesAddresses.join(", "),
    notifyLeadCreated: s.notifyLeadCreated,
    notifyLeadAssigned: s.notifyLeadAssigned,
    notifyFormSubmission: s.notifyFormSubmission,
  };
}

/** A switch: a real button with `role="switch"`, so it works by keyboard and is announced as on/off. */
function Toggle({
  id,
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-navy-800">
          {label}
        </label>
        {hint ? <p className="mt-0.5 text-2xs text-ink-subtle">{hint}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? "bg-navy-800" : "bg-line-strong"}`}
      >
        <span
          aria-hidden="true"
          className={`inline-block size-5 rounded-full bg-white shadow-xs transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}

function Outcome({ result }: { result: { ok: boolean; message: string } | null }) {
  if (!result) return null;
  return result.ok ? (
    <p role="status" className="flex items-start gap-1.5 text-xs text-success">
      <CheckCircle2 size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      {result.message}
    </p>
  ) : (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-brand-red-text">
      <AlertCircle size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
      {result.message}
    </p>
  );
}

/** A port and encryption that rarely go together, said before it fails rather than after. */
function mismatch(port: string, encryption: SmtpEncryption): string | null {
  if (port === "465" && encryption === "STARTTLS") return "Port 465 normally uses SSL/TLS, not STARTTLS.";
  if (port === "587" && encryption === "SSL_TLS") return "Port 587 normally uses STARTTLS, not SSL/TLS.";
  if (encryption === "NONE" && port !== "25" && port !== "2525") return "Without encryption the password travels in plain text. Use it only on a trusted network.";
  return null;
}

export function SmtpSettingsForm({
  initial,
  canEdit,
  canSend,
}: {
  initial: SafeEmailSettings;
  canEdit: boolean;
  canSend: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [settings, setSettings] = React.useState(initial);
  const [values, setValues] = React.useState<Values>(() => fromSettings(initial));
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [saving, startSave] = React.useTransition();
  const [testing, startTest] = React.useTransition();
  const [sending, startSend] = React.useTransition();
  const [verifyResult, setVerifyResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [sendResult, setSendResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const [recipient, setRecipient] = React.useState("");

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((current) => ({ ...current, [key]: value }));
  const error = (key: string) => errors[key]?.[0];
  const payload = () => ({ ...values });
  const warning = mismatch(values.port.trim(), values.encryption);
  const locked = !canEdit || saving;

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    startSave(async () => {
      const result = await saveSmtpSettingsAction(payload());
      if (!result.ok) {
        setErrors((result.details as Record<string, string[]> | undefined) ?? {});
        push({ tone: "error", title: "Not saved.", description: result.message });
        return;
      }
      setErrors({});
      setSettings(result.data.settings);
      setValues(fromSettings(result.data.settings));
      push({ tone: "success", title: result.data.message });
      router.refresh();
    });
  };

  const test = () => {
    setVerifyResult(null);
    startTest(async () => {
      const result = await verifySmtpAction(payload());
      setVerifyResult(result.ok ? { ok: true, message: result.data.message } : { ok: false, message: result.message });
    });
  };

  const send = () => {
    setSendResult(null);
    startSend(async () => {
      const result = await sendSmtpTestAction({ to: recipient });
      setSendResult(result.ok ? { ok: true, message: result.data.message } : { ok: false, message: result.message });
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {settings.saved && settings.host && !settings.enabled ? (
        <p role="status" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-bg px-3.5 py-3 text-xs text-warning">
          <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          Email is switched off, so nothing is being sent. Turn it on below when the settings are ready.
        </p>
      ) : !settings.host && settings.source === "environment" ? (
        <p role="status" className="rounded-md border border-line bg-surface-muted px-3.5 py-3 text-xs text-ink-muted">
          Email currently goes out through the server&rsquo;s SMTP_* environment settings. Saving settings here takes over from them.
        </p>
      ) : !settings.host && settings.source === "none" ? (
        <p role="status" className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-bg px-3.5 py-3 text-xs text-warning">
          <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          No mail server is set up, so every email is recorded as failed. Enter the SMTP details below.
        </p>
      ) : null}

      <form onSubmit={save} noValidate className="space-y-6">
        <Card>
          <CardHeader className="flex-col items-start gap-0.5">
            <CardTitle>SMTP server</CardTitle>
            <CardDescription>Credentials are encrypted before they are stored.</CardDescription>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <Field id="smtp-host" label="Host" error={error("host")}>
                {(aria) => (
                  <Input {...aria} value={values.host} onChange={(e) => set("host", e.target.value)} placeholder="smtp.example.com" autoComplete="off" disabled={locked} />
                )}
              </Field>
              <Field id="smtp-port" label="Port" error={error("port")}>
                {(aria) => <Input {...aria} inputMode="numeric" value={values.port} onChange={(e) => set("port", e.target.value)} disabled={locked} />}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="smtp-username" label="Username" error={error("username")}>
                {(aria) => <Input {...aria} value={values.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" disabled={locked} />}
              </Field>
              <Field
                id="smtp-password"
                label="Password"
                error={error("password")}
                hint={settings.passwordConfigured && !values.removePassword ? "A password is stored. Leave blank to keep it." : undefined}
              >
                {(aria) => (
                  <Input
                    {...aria}
                    type="password"
                    value={values.password}
                    onChange={(e) => set("password", e.target.value)}
                    placeholder={settings.passwordConfigured && !values.removePassword ? "••••••••" : ""}
                    autoComplete="new-password"
                    disabled={locked || values.removePassword}
                  />
                )}
              </Field>
            </div>
            {settings.passwordConfigured ? (
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={values.removePassword}
                  onChange={(e) => setValues((current) => ({ ...current, removePassword: e.target.checked, password: "" }))}
                  disabled={locked}
                  className="accent-brand-red"
                />
                Remove the stored password
              </label>
            ) : null}
            <Field id="smtp-encryption" label="Encryption" error={error("encryption")} hint={warning ?? undefined}>
              {(aria) => (
                <Select {...aria} value={values.encryption} onChange={(e) => set("encryption", e.target.value as SmtpEncryption)} disabled={locked}>
                  {SMTP_ENCRYPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {SMTP_ENCRYPTION_LABEL[option]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="smtp-from-name" label="From name" required error={error("fromName")}>
                {(aria) => <Input {...aria} value={values.fromName} onChange={(e) => set("fromName", e.target.value)} disabled={locked} />}
              </Field>
              <Field id="smtp-from-address" label="From address" required error={error("fromAddress")}>
                {(aria) => <Input {...aria} type="email" value={values.fromAddress} onChange={(e) => set("fromAddress", e.target.value)} disabled={locked} />}
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="smtp-reply-to" label="Reply-to" error={error("replyTo")} hint="Lead notifications already reply to the lead's own address.">
                {(aria) => <Input {...aria} type="email" value={values.replyTo} onChange={(e) => set("replyTo", e.target.value)} disabled={locked} />}
              </Field>
            </div>
            <div className="rounded-md border border-line px-3.5">
              <Toggle
                id="smtp-enabled"
                checked={values.enabled}
                onChange={(next) => set("enabled", next)}
                disabled={locked}
                label="Send email using these settings"
                hint="When off, nothing is sent — useful while you are still setting up."
              />
            </div>
            <Outcome result={verifyResult} />
          </CardBody>
          <CardFooter className="flex flex-wrap items-center justify-end gap-2">
            {canEdit ? (
              <>
                <Button type="button" variant="secondary" onClick={test} disabled={testing || saving}>
                  <PlugZap size={14} aria-hidden="true" />
                  {testing ? "Testing…" : "Test connection"}
                </Button>
                <Button type="submit" disabled={saving}>
                  <Save size={14} aria-hidden="true" />
                  {saving ? "Saving…" : "Save email settings"}
                </Button>
              </>
            ) : (
              <p className="text-xs text-ink-subtle">You can see these settings but not change them.</p>
            )}
          </CardFooter>
        </Card>

        <Card>
          <CardHeader className="flex-col items-start gap-0.5">
            <CardTitle>Notifications</CardTitle>
            <CardDescription>Who hears about new activity.</CardDescription>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field id="smtp-sales" label="Sales notification addresses" error={error("salesAddresses")} hint="Comma separated, up to 20. These get the emails switched on below.">
              {(aria) => (
                <Input {...aria} value={values.salesAddresses} onChange={(e) => set("salesAddresses", e.target.value)} placeholder="sales@example.com, ops@example.com" disabled={locked} />
              )}
            </Field>
            <div className="divide-y divide-line rounded-md border border-line px-3.5">
              <Toggle
                id="notify-lead"
                checked={values.notifyLeadCreated}
                onChange={(next) => set("notifyLeadCreated", next)}
                disabled={locked}
                label="Email sales when a lead is captured"
                hint="To the addresses above and to whoever the lead is assigned to (or the sales team), with the form details."
              />
              <Toggle
                id="notify-assigned"
                checked={values.notifyLeadAssigned}
                onChange={(next) => set("notifyLeadAssigned", next)}
                disabled={locked}
                label="Email a staff member when a lead is assigned to them"
              />
              <Toggle
                id="notify-submission"
                checked={values.notifyFormSubmission}
                onChange={(next) => set("notifyFormSubmission", next)}
                disabled={locked}
                label="Email on every form submission"
                hint="The form details, to the addresses above. With lead emails on as well, only the lead email goes — it already carries the details."
              />
            </div>
            <p className="text-2xs text-ink-subtle">These are saved with “Save email settings” above.</p>
          </CardBody>
        </Card>
      </form>

      <Card>
        <CardHeader className="flex-col items-start gap-0.5">
          <CardTitle>Send a test</CardTitle>
          <CardDescription>Confirms the whole path end to end.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="smtp-test-to" className="sr-only">
              Test recipient
            </label>
            <Input
              id="smtp-test-to"
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="you@example.com"
              disabled={!canSend || sending}
              className="sm:flex-1"
            />
            <Button type="button" onClick={send} disabled={!canSend || sending || !recipient.trim()}>
              <Send size={14} aria-hidden="true" />
              {sending ? "Sending…" : "Send test"}
            </Button>
          </div>
          <Outcome result={sendResult} />
          {!canSend ? <p className="text-xs text-ink-subtle">Sending a test needs permission to send email.</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}
