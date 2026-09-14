"use client";

import * as React from "react";
import { useTransition } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { Button, Dialog, Field, Input, Select, useToast } from "@/components/ui";
import { useHydrated } from "@/lib/utils/hydrated";
import { describeRule, type AudienceRule } from "@/lib/content/audience";
import { setSectionAudienceAction } from "../../actions";

/**
 * Who a band is for.
 *
 * Rules are OR-ed: "paid traffic *or* returning visitors". Within one rule
 * every condition must hold. No rules at all means everyone, which is what a
 * band without this dialog already was.
 *
 * The attributes offered are the ones the server genuinely knows — device from
 * the user agent, new-versus-returning from the visitor cookie, and the UTM and
 * referrer values already captured for attribution. There is no visitor city:
 * this application has no geo-IP, and offering the field would promise an
 * audience it cannot identify.
 */

const EMPTY: AudienceRule = {
  visitorType: "ANY",
  device: "ANY",
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  referrerContains: null,
};

export function AudienceDialog({
  sectionId,
  label,
  rules,
  onClose,
  onSaved,
}: {
  sectionId: string;
  label: string;
  rules: readonly AudienceRule[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { push } = useToast();
  const ready = useHydrated();
  const [pending, start] = useTransition();
  const [draft, setDraft] = React.useState<AudienceRule[]>(() => rules.map((rule) => ({ ...rule })));
  const [error, setError] = React.useState<string | null>(null);

  const update = (index: number, patch: Partial<AudienceRule>) =>
    setDraft((current) =>
      current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );

  const save = () => {
    setError(null);
    start(async () => {
      const result = await setSectionAudienceAction(sectionId, draft);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      push({
        tone: "success",
        title: draft.length === 0 ? "Shown to everyone." : "Audience saved.",
      });
      onSaved();
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Who sees ${label}?`}
      description="Rules are combined with OR. With no rules, everyone sees this band."
    >
      <div className="space-y-4">
        {draft.length === 0 ? (
          <p className="rounded-md border border-line bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
            Everyone sees this band.
          </p>
        ) : null}

        {draft.map((rule, index) => (
          <div key={index} className="rounded-lg border border-line p-3.5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-navy-800">{describeRule(rule)}</p>
              <button
                type="button"
                onClick={() => setDraft((current) => current.filter((_, i) => i !== index))}
                className="rounded-sm p-1 text-ink-subtle hover:text-brand-red"
              >
                <Trash2 size={13} aria-hidden="true" />
                <span className="sr-only">Remove this rule</span>
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`visitor-${index}`} label="Visitor">
                {(aria) => (
                  <Select
                    {...aria}
                    value={rule.visitorType}
                    onChange={(e) =>
                      update(index, { visitorType: e.target.value as AudienceRule["visitorType"] })
                    }
                  >
                    <option value="ANY">Anyone</option>
                    <option value="NEW">First time here</option>
                    <option value="RETURNING">Returning</option>
                  </Select>
                )}
              </Field>

              <Field id={`device-${index}`} label="Device">
                {(aria) => (
                  <Select
                    {...aria}
                    value={rule.device}
                    onChange={(e) =>
                      update(index, { device: e.target.value as AudienceRule["device"] })
                    }
                  >
                    <option value="ANY">Any device</option>
                    <option value="DESKTOP">Desktop</option>
                    <option value="TABLET">Tablet</option>
                    <option value="MOBILE">Mobile</option>
                  </Select>
                )}
              </Field>

              <Field id={`source-${index}`} label="UTM source" hint="e.g. google. Blank is any.">
                {(aria) => (
                  <Input
                    {...aria}
                    value={rule.utmSource ?? ""}
                    onChange={(e) => update(index, { utmSource: e.target.value || null })}
                  />
                )}
              </Field>

              <Field id={`medium-${index}`} label="UTM medium" hint="e.g. cpc. Blank is any.">
                {(aria) => (
                  <Input
                    {...aria}
                    value={rule.utmMedium ?? ""}
                    onChange={(e) => update(index, { utmMedium: e.target.value || null })}
                  />
                )}
              </Field>

              <Field id={`campaign-${index}`} label="UTM campaign" hint="Blank is any.">
                {(aria) => (
                  <Input
                    {...aria}
                    value={rule.utmCampaign ?? ""}
                    onChange={(e) => update(index, { utmCampaign: e.target.value || null })}
                  />
                )}
              </Field>

              <Field id={`referrer-${index}`} label="Referrer contains" hint="Blank is any.">
                {(aria) => (
                  <Input
                    {...aria}
                    value={rule.referrerContains ?? ""}
                    onChange={(e) => update(index, { referrerContains: e.target.value || null })}
                  />
                )}
              </Field>
            </div>
          </div>
        ))}

        {error ? (
          <p role="alert" className="text-xs text-brand-red-text">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setDraft((current) => [...current, { ...EMPTY }])}
          >
            <Plus size={13} aria-hidden="true" />
            Add a rule
          </Button>
          <Button size="sm" disabled={pending || !ready} onClick={save}>
            <Users size={13} aria-hidden="true" />
            {pending ? "Saving…" : "Save audience"}
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>

        <p className="text-2xs text-ink-subtle">
          Matching happens on the server before the page is sent, so a band a visitor is not the
          audience for never reaches their browser. There is no location rule: this application has
          no geo-IP, and guessing one would be an audience nobody can stand behind.
        </p>
      </div>
    </Dialog>
  );
}
