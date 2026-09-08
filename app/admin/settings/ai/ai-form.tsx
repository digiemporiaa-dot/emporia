"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, KeyRound, Plug } from "lucide-react";
import { Button, Card, CardBody, Field, Input, Select } from "@/components/ui";
import { AI_LIMITS, PROVIDER_CATALOG, type AIProviderId } from "@/lib/ai/catalog";
import type { AdminAISettings } from "@/lib/services/ai-settings.service";
import {
  clearAIApiKeyAction,
  saveAIApiKeyAction,
  saveAISettingsAction,
  testAIConnectionAction,
  type AIActionState,
  type TestState,
} from "./actions";

/**
 * AI and LLM settings.
 *
 * One form for the configuration, a second for the API key. The split is the
 * point: the key is write-only, so it is never a field in a form that is
 * re-posted whenever someone nudges the temperature — and the settings form has
 * no way to clear or overwrite it by accident.
 *
 * What arrives here from the server is a mask, never the key. There is no path
 * that puts the credential into an input's value, into a React prop, or into
 * the HTML (CLAUDE.md 2 rule 6).
 */

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : label}
    </Button>
  );
}

export function AISettingsForm({ settings }: { settings: AdminAISettings }) {
  const [state, formAction] = useActionState<AIActionState, FormData>(saveAISettingsAction, null);
  const [test, testAction] = useActionState<TestState, FormData>(testAIConnectionAction, null);

  const fieldErrors = (state && !state.ok ? state.details : null) as
    | Record<string, string[]>
    | null
    | undefined;
  const err = (name: string) => fieldErrors?.[name]?.[0];

  // React resets an uncontrolled form once its action resolves, so a rejected
  // save would otherwise clear everything that was typed.
  const submitted = state && !state.ok ? state.values : undefined;
  const text = (name: string, stored: string | number) =>
    submitted?.[name] ?? String(stored);

  // The provider drives the defaults offered for the model and the endpoint, so
  // switching to Gemini fills in Gemini's rather than leaving Anthropic's.
  const [provider, setProvider] = React.useState<AIProviderId>(settings.provider);
  const [model, setModel] = React.useState(text("model", settings.model));
  const [baseUrl, setBaseUrl] = React.useState(text("baseUrl", settings.baseUrl));
  const [temperature, setTemperature] = React.useState(text("temperature", settings.temperature));
  const [maxOutputTokens, setMaxOutputTokens] = React.useState(
    text("maxOutputTokens", settings.maxOutputTokens),
  );
  const [enabled, setEnabled] = React.useState(
    submitted ? submitted["enabled"] === "on" : settings.enabled,
  );
  /**
   * A key typed but not saved.
   *
   * Held in the input itself, read through a ref, and never in React state or a
   * hidden field. Two reasons: a controlled value renders into the DOM as an
   * attribute, where a hidden field would put the whole secret into the page's
   * markup; and a secret in state is a secret that rides along with every
   * unrelated re-render. Test Connection reads it once, at the moment it sends.
   */
  const keyRef = React.useRef<HTMLInputElement>(null);
  const [testing, startTest] = React.useTransition();
  const definition = PROVIDER_CATALOG[provider];

  const changeProvider = (next: AIProviderId) => {
    const from = PROVIDER_CATALOG[provider];
    setProvider(next);
    // Only replaced when the field still holds the previous provider's default:
    // a model someone typed themselves is theirs to keep.
    if (model === from.defaultModel || model === "") setModel(PROVIDER_CATALOG[next].defaultModel);
    if (baseUrl === from.defaultBaseUrl || baseUrl === "") {
      setBaseUrl(PROVIDER_CATALOG[next].defaultBaseUrl);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      {settings.usingEnvFallback ? (
        <div
          role="status"
          className="rounded-md border border-line bg-surface-muted px-3.5 py-3 text-sm text-ink-muted"
        >
          Currently running on the provider configured in the environment. Saving here takes over
          from it — the environment stays as a fallback for a deployment that has never been
          configured from this screen.
        </div>
      ) : null}

      <form action={formAction} className="space-y-5" noValidate>
        {state && !state.ok ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
          >
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{state.message}</span>
          </div>
        ) : null}

        {state?.ok ? (
          <div
            role="status"
            className="rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
          >
            AI settings saved. The next request uses them — no restart needed.
          </div>
        ) : null}

        <Card>
          <CardBody className="space-y-5">
            <label className="flex items-center gap-2 text-sm text-navy-800">
              <input
                type="checkbox"
                name="enabled"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="size-4 accent-[var(--color-brand-red)]"
              />
              AI is switched on
            </label>
            <p className="text-xs text-ink-subtle">
              Off means the assist buttons are not offered anywhere. Nothing invents an answer to
              stand in for one.
            </p>

            <Field id="provider" label="Provider" error={err("provider")}>
              {(aria) => (
                <Select
                  {...aria}
                  name="provider"
                  value={provider}
                  onChange={(event) => changeProvider(event.target.value as AIProviderId)}
                >
                  {Object.values(PROVIDER_CATALOG).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              id="model"
              label="Model"
              hint="Type any model the provider offers — this is not a fixed list, so a new release needs no deploy."
              error={err("model")}
            >
              {(aria) => (
                <>
                  <Input
                    {...aria}
                    name="model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    list="ai-model-suggestions"
                    className="font-mono"
                  />
                  <datalist id="ai-model-suggestions">
                    {definition.suggestedModels.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>

            <Field
              id="baseUrl"
              label="Base URL"
              hint="The provider's API root. http and https only."
              error={err("baseUrl")}
            >
              {(aria) => (
                <Input
                  {...aria}
                  name="baseUrl"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  className="font-mono"
                />
              )}
            </Field>

            {provider === "gemini" ? (
              <p className="rounded-md border border-line bg-surface-muted px-3 py-2 font-mono text-2xs break-all text-ink-subtle">
                {`${baseUrl.replace(/\/+$/, "")}/models/${model || "…"}:generateContent`}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-5">
            <p className="text-2xs font-semibold uppercase tracking-widest text-ink-subtle">
              Advanced
            </p>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                id="temperature"
                label="Temperature"
                hint={`${AI_LIMITS.temperature.min} is repeatable, ${AI_LIMITS.temperature.max} is loose.`}
                error={err("temperature")}
              >
                {(aria) => (
                  <Input
                    {...aria}
                    name="temperature"
                    type="number"
                    step="0.1"
                    min={AI_LIMITS.temperature.min}
                    max={AI_LIMITS.temperature.max}
                    value={temperature}
                    onChange={(event) => setTemperature(event.target.value)}
                  />
                )}
              </Field>
              <Field
                id="maxOutputTokens"
                label="Max output tokens"
                hint="A ceiling per request. Individual features may ask for less."
                error={err("maxOutputTokens")}
              >
                {(aria) => (
                  <Input
                    {...aria}
                    name="maxOutputTokens"
                    type="number"
                    min={AI_LIMITS.maxOutputTokens.min}
                    max={AI_LIMITS.maxOutputTokens.max}
                    value={maxOutputTokens}
                    onChange={(event) => setMaxOutputTokens(event.target.value)}
                  />
                )}
              </Field>
            </div>
          </CardBody>
        </Card>

        <div className="border-t border-line pt-5">
          <Submit label="Save settings" busy="Saving…" />
        </div>
      </form>

      {/*
        Not a form. The payload is built in JavaScript at the moment of sending,
        so the API key never becomes a hidden input's value — which is markup,
        and markup is a place a secret is easy to forget about.
      */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={testing}
          onClick={() => {
            const payload = new FormData();
            payload.set("provider", provider);
            payload.set("model", model);
            payload.set("baseUrl", baseUrl);
            payload.set("temperature", temperature);
            payload.set("maxOutputTokens", maxOutputTokens);
            // Read once, sent once, never stored. Blank means "use the saved
            // key", which the action resolves server-side.
            payload.set("apiKey", keyRef.current?.value ?? "");
            startTest(() => testAction(payload));
          }}
        >
          <Plug size={14} aria-hidden="true" />
          {testing ? "Testing…" : "Test connection"}
        </Button>
        <p className="text-xs text-ink-subtle">
          Sends one real request to the provider using the values above. Works before saving.
        </p>
      </div>

      <TestResult test={test} />

      <ApiKeyPanel
        masked={settings.apiKeyMasked}
        unreadable={settings.apiKeyUnreadable}
        fromEnv={settings.usingEnvFallback}
        hint={definition.keyHint}
        inputRef={keyRef}
      />
    </div>
  );
}

function TestResult({ test }: { test: TestState }) {
  if (!test) return null;

  if (test.ok) {
    return (
      <div
        role="status"
        className="rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
      >
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 size={16} aria-hidden="true" />
          Connection successful
        </p>
        <dl className="mt-2 space-y-0.5 text-xs">
          <div className="flex gap-2">
            <dt className="text-ink-subtle">Provider</dt>
            <dd>{test.provider}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-ink-subtle">Model</dt>
            <dd className="font-mono">{test.model}</dd>
          </div>
          {test.sample ? (
            <div className="flex gap-2">
              <dt className="text-ink-subtle">Replied</dt>
              <dd className="font-mono">{test.sample}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
    >
      <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span>
        {test.message}
        {test.reason ? (
          <span className="ml-1.5 font-mono text-2xs text-ink-subtle">{test.reason}</span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * The provider API key.
 *
 * Its own form and its own action. What arrives from the server is a mask;
 * saving replaces. There is no "edit" — a write-only field is the only shape
 * that keeps the key out of the browser.
 */
function ApiKeyPanel({
  masked,
  unreadable,
  fromEnv,
  hint,
  inputRef,
}: {
  masked: string | null;
  unreadable: boolean;
  fromEnv: boolean;
  hint: string;
  /**
   * The parent reads this when Test Connection is pressed, so an unsaved key
   * can be tested without ever leaving the input it was typed into.
   */
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [saveState, saveAction] = useActionState<AIActionState, FormData>(
    saveAIApiKeyAction,
    null,
  );
  const [clearState, clearAction] = useActionState<AIActionState, FormData>(
    clearAIApiKeyAction,
    null,
  );
  const failure = [saveState, clearState].find((entry) => entry && !entry.ok);
  const success = [saveState, clearState].some((entry) => entry?.ok);

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-start gap-2">
          <KeyRound size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-brand-red" />
          <div>
            <h2 className="font-display text-sm text-navy-800">API key</h2>
            <p className="mt-1 text-xs text-ink-subtle">
              Encrypted before it is stored and never sent back to the browser. {hint}
            </p>
          </div>
        </div>

        {failure && !failure.ok ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3.5 py-3 text-sm text-brand-red-text"
          >
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{failure.message}</span>
          </div>
        ) : null}

        {success && !failure ? (
          <div
            role="status"
            className="rounded-md border border-success/30 bg-success-bg px-3.5 py-3 text-sm text-success"
          >
            Saved.
          </div>
        ) : null}

        {unreadable ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-bg px-3.5 py-3 text-sm text-warning"
          >
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              A key is stored but can no longer be decrypted — this happens when AUTH_SECRET is
              rotated. Enter it again to restore AI.
            </span>
          </div>
        ) : (
          <p className="text-xs text-ink-muted">
            {masked ? (
              <>
                <CheckCircle2 size={13} aria-hidden="true" className="mr-1 inline text-success" />
                API key configured: <span className="font-mono tabular-nums">{masked}</span>
              </>
            ) : (
              "No API key stored."
            )}
          </p>
        )}

        <form action={saveAction} className="space-y-3" noValidate>
          <Field
            id="apiKey"
            label={masked ? "Replace key" : "API key"}
            hint={
              fromEnv
                ? "Saving a key here takes over from the one in the environment."
                : "Leave blank to keep the stored key."
            }
          >
            {(aria) => (
              <Input
                {...aria}
                ref={inputRef}
                name="apiKey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                // Uncontrolled on purpose: a controlled value is rendered into
                // the DOM as an attribute, which puts the whole key into the
                // page's markup.
                placeholder={masked ? "Enter a new key to replace it" : "Paste the provider's key"}
              />
            )}
          </Field>
          <Submit label={masked ? "Replace key" : "Save key"} busy="Saving…" />
        </form>

        {masked || unreadable ? (
          <form action={clearAction} className="border-t border-line pt-3">
            <p className="mb-2 text-xs text-ink-subtle">
              Removing the key also switches AI off — leaving it on would mean offering assist
              buttons that cannot run.
            </p>
            <Button type="submit" variant="secondary" size="sm">
              Remove key
            </Button>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
