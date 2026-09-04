import "server-only";
import { db } from "@/lib/db";
import { record } from "@/lib/services/audit.service";
import { log } from "@/lib/logger";
import { matches, type Condition } from "@/lib/automation/conditions";
import { buildFacts } from "@/lib/automation/facts";
import { automationActor, runAction, type ActionOutcome } from "@/lib/automation/actions";
import { actionConfigSchema } from "@/lib/validation/automation";
import type { Facts, Subject, WiredTrigger } from "@/lib/automation/types";

/**
 * The engine.
 *
 * `runAutomations` is called **after** the mutation it reacts to has committed.
 * That is deliberate: an automation must never be the reason a lead fails to be
 * captured or a proposal fails to be accepted. It also means a rule sees the
 * record in its settled state.
 *
 * Nothing here throws to its caller. A broken rule is logged, recorded and
 * skipped; the business operation that triggered it has already succeeded.
 */

const engineLog = log("automation");

export type RuleOutcome = {
  automationId: string;
  name: string;
  matched: boolean;
  actions: ActionOutcome[];
  error?: string;
};

export async function runAutomations(
  trigger: WiredTrigger,
  subject: Subject,
  extraFacts: Facts = {},
): Promise<RuleOutcome[]> {
  try {
    const rules = await db.automation.findMany({
      where: { isActive: true, triggers: { some: { type: trigger } } },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        conditions: { orderBy: { order: "asc" }, select: { field: true, operator: true, value: true } },
        actions: { orderBy: { order: "asc" }, select: { type: true, config: true } },
      },
    });

    if (rules.length === 0) return [];

    // Built once and shared by every rule for this trigger — the facts describe
    // the record, not the rule.
    const facts = await buildFacts(trigger, subject, extraFacts);
    const outcomes: RuleOutcome[] = [];

    for (const rule of rules) {
      const conditions = rule.conditions as unknown as Condition[];

      if (!matches(conditions, facts)) {
        outcomes.push({ automationId: rule.id, name: rule.name, matched: false, actions: [] });
        continue;
      }

      const actions: ActionOutcome[] = [];

      for (const action of rule.actions) {
        // The stored config is re-validated at fire time. A rule saved before a
        // config shape changed must fail visibly here rather than reach a
        // handler with a shape it does not understand.
        const parsed = actionConfigSchema.safeParse({ ...(action.config as object), type: action.type });

        if (!parsed.success) {
          actions.push({
            type: action.type,
            changed: false,
            detail: `Skipped: this action's settings are no longer valid (${parsed.error.issues[0]?.message ?? "invalid"}).`,
          });
          continue;
        }

        try {
          // `subject` is passed by reference on purpose: CREATE_PROJECT sets
          // projectId on it so a later CREATE_PROJECT_TASKS in the same rule
          // knows where the tasks go.
          actions.push(await runAction(parsed.data, subject, facts));
        } catch (error) {
          engineLog.error({ err: error, automationId: rule.id, action: action.type }, "action failed");
          actions.push({
            type: action.type,
            changed: false,
            detail: `Failed: ${error instanceof Error ? error.message : "unknown error"}.`,
          });
        }
      }

      outcomes.push({ automationId: rule.id, name: rule.name, matched: true, actions });

      // One audit row per rule that ran, alongside the per-action rows the
      // handlers write. This is the record an admin reads back.
      await record({
        actor: automationActor(),
        action: "UPDATE",
        entityType: "Automation",
        entityId: rule.id,
        after: {
          trigger,
          subject,
          actions: actions.map((a) => ({ type: a.type, changed: a.changed, detail: a.detail })),
        },
      });
    }

    engineLog.info(
      { trigger, ran: outcomes.filter((o) => o.matched).length, considered: rules.length },
      "automations evaluated",
    );

    return outcomes;
  } catch (error) {
    // The triggering operation has already committed. Never let a rule undo it.
    engineLog.error({ err: error, trigger, subject }, "automation run failed");
    return [];
  }
}

/**
 * Evaluate a rule against a real record without doing anything.
 *
 * The admin's "test this rule" button. It reports whether the conditions match
 * and which actions *would* run — it never executes one, so trying a rule on a
 * live lead is safe.
 */
export async function previewAutomation(
  automationId: string,
  subject: Subject,
): Promise<{ matched: boolean; facts: Facts; actions: string[] } | null> {
  const rule = await db.automation.findUnique({
    where: { id: automationId },
    select: {
      triggers: { select: { type: true } },
      conditions: { orderBy: { order: "asc" }, select: { field: true, operator: true, value: true } },
      actions: { orderBy: { order: "asc" }, select: { type: true } },
    },
  });

  if (!rule) return null;

  const trigger = rule.triggers[0]?.type as WiredTrigger | undefined;
  if (!trigger) return null;

  const facts = await buildFacts(trigger, subject);

  return {
    matched: matches(rule.conditions as unknown as Condition[], facts),
    facts,
    actions: rule.actions.map((action) => action.type),
  };
}
