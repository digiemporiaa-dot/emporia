import "server-only";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { record, withAudit } from "@/lib/services/audit.service";
import { read, type ArmResult, type ExperimentReading } from "@/lib/experiments/stats";
import { PAGE_TAG } from "@/lib/services/page.service";
import type { Actor } from "@/lib/actor/types";
import type { ExperimentInput } from "@/lib/validation/experiment";

/**
 * A/B tests.
 *
 * Managed under `pages.publish` rather than a new permission namespace:
 * starting an experiment changes what the public site shows to a share of its
 * visitors, which is publishing by any reading of it. Templates took the same
 * view for the same reason.
 *
 * ## What is stored and what is not
 *
 * Assignment is **not** stored — `lib/experiments/assign.ts` derives it from
 * the visitor id and the experiment key, so a visitor sees the same arm on
 * every visit without a lookup or a write on the render path.
 *
 * Exposures **are** stored, once per visitor per experiment. A sample size
 * cannot be derived from anything else, and without one a verdict is a guess
 * (CLAUDE.md 5). That unique constraint is the point: a visitor counts once
 * however many times they reload, so the denominator is people, not page views.
 */

const experimentSelect = {
  id: true,
  key: true,
  name: true,
  hypothesis: true,
  status: true,
  startedAt: true,
  stoppedAt: true,
  createdAt: true,
  variants: {
    orderBy: { key: "asc" as const },
    select: {
      id: true,
      key: true,
      name: true,
      weight: true,
      _count: { select: { sections: true, exposures: true } },
    },
  },
} as const;

export async function listExperiments(actor: Actor) {
  requirePermission(actor, "pages.view");

  return db.experiment.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: experimentSelect,
  });
}

export async function getExperiment(actor: Actor, id: string) {
  requirePermission(actor, "pages.view");

  const experiment = await db.experiment.findUnique({ where: { id }, select: experimentSelect });
  if (!experiment) throw new NotFoundError("That experiment does not exist.");
  return experiment;
}

export async function createExperiment(actor: Actor, input: ExperimentInput) {
  requirePermission(actor, "pages.publish");

  const clash = await db.experiment.findUnique({ where: { key: input.key }, select: { id: true } });
  if (clash) throw new ConflictError("An experiment already uses that handle.");

  const experiment = await db.$transaction(async (tx) => {
    const created = await tx.experiment.create({
      data: {
        key: input.key,
        name: input.name,
        hypothesis: input.hypothesis ?? null,
        // Two arms, created with the experiment. An experiment with one arm is
        // not a test, and creating them separately would allow that state to
        // exist in the database at all.
        variants: {
          create: input.variants.map((variant) => ({
            key: variant.key,
            name: variant.name,
            weight: variant.weight,
          })),
        },
      },
      select: { id: true, key: true },
    });
    await record(
      { actor, action: "CREATE", entityType: "Experiment", entityId: created.id, after: created },
      tx,
    );
    return created;
  });

  return experiment;
}

/**
 * Start, stop, or put an experiment back in draft.
 *
 * Stopping does not delete the exposures: the result is the reason the test
 * was run, and a stopped test whose numbers vanished would be a test nobody
 * could learn from. Returning a running test to draft is refused for the same
 * reason — it would leave exposures attached to a test that claims never to
 * have run.
 */
export async function setExperimentStatus(
  actor: Actor,
  id: string,
  status: "DRAFT" | "RUNNING" | "STOPPED",
) {
  requirePermission(actor, "pages.publish");

  const before = await db.experiment.findUnique({
    where: { id },
    select: { id: true, status: true, startedAt: true, _count: { select: { variants: true } } },
  });
  if (!before) throw new NotFoundError("That experiment does not exist.");

  if (status === "RUNNING" && before._count.variants < 2) {
    throw new ValidationError("An experiment needs two arms before it can run.");
  }

  if (status === "DRAFT" && before.status !== "DRAFT") {
    throw new ValidationError(
      "A test that has run cannot go back to draft. Stop it instead — its numbers are the reason it was run.",
    );
  }

  const updated = await withAudit(
    {
      actor,
      action: status === "RUNNING" ? "PUBLISH" : "UPDATE",
      entityType: "Experiment",
      entityId: id,
      before,
    },
    (tx) =>
      tx.experiment.update({
        where: { id },
        data: {
          status,
          ...(status === "RUNNING" && !before.startedAt ? { startedAt: new Date() } : {}),
          ...(status === "STOPPED" ? { stoppedAt: new Date() } : {}),
        },
      }),
  );

  revalidateTag(PAGE_TAG);
  return updated;
}

/**
 * Delete an experiment.
 *
 * Refused once it has exposures. Those rows are the record of what the site
 * showed people and what they did; deleting them to tidy a list is deleting
 * the only evidence the test produced.
 */
export async function deleteExperiment(actor: Actor, id: string) {
  requirePermission(actor, "pages.publish");

  const before = await db.experiment.findUnique({
    where: { id },
    select: { id: true, key: true, name: true, _count: { select: { exposures: true } } },
  });
  if (!before) throw new NotFoundError("That experiment does not exist.");

  if (before._count.exposures > 0) {
    throw new ConflictError(
      `${before._count.exposures} visitors have seen this test. Stop it instead — deleting it would destroy the only record of what they were shown.`,
    );
  }

  const deleted = await withAudit(
    { actor, action: "DELETE", entityType: "Experiment", entityId: id, before },
    (tx) => tx.experiment.delete({ where: { id }, select: { id: true } }),
  );

  revalidateTag(PAGE_TAG);
  return deleted;
}

/** Attach a band to an arm, or detach it. */
export async function setSectionVariant(
  actor: Actor,
  sectionId: string,
  variantId: string | null,
) {
  requirePermission(actor, "pages.edit");

  const section = await db.pageSection.findFirst({
    where: { id: sectionId, page: { deletedAt: null } },
    select: { id: true, variantId: true },
  });
  if (!section) throw new NotFoundError("That section does not exist.");

  if (variantId) {
    const variant = await db.experimentVariant.findUnique({
      where: { id: variantId },
      select: { id: true },
    });
    if (!variant) throw new ValidationError("That experiment arm does not exist.");
  }

  const updated = await withAudit(
    {
      actor,
      action: "UPDATE",
      entityType: "PageSection variant",
      entityId: sectionId,
      before: section,
    },
    (tx) => tx.pageSection.update({ where: { id: sectionId }, data: { variantId } }),
  );

  revalidateTag(PAGE_TAG);
  return updated;
}

/**
 * Record that a visitor saw an arm.
 *
 * Once per visitor per experiment, enforced by the unique constraint rather
 * than by a read-then-write that two concurrent requests would both pass.
 * Deliberately tolerant: failing to record an exposure must never break the
 * page the visitor is on — the same posture `recordEvent` takes for popups.
 */
export async function recordExposure(input: {
  experimentId: string;
  variantId: string;
  visitorId: string;
}): Promise<void> {
  try {
    await db.experimentExposure.createMany({
      data: [input],
      // The visitor has been counted already. That is the normal case on every
      // page after the first, not an error.
      skipDuplicates: true,
    });
  } catch {
    // Swallowed on purpose. A sample is not worth a 500 to the visitor.
  }
}

/**
 * What the experiment shows so far.
 *
 * Conversions are joined through the attribution the CRM already records: a
 * lead's first or last touch carries the `visitorId`, and an exposure carries
 * the same id, so a lead is attributed to the arm its visitor was shown. No
 * new tracking, and no second definition of what a conversion is.
 */
export async function experimentResults(
  actor: Actor,
  id: string,
): Promise<{ arms: ArmResult[]; reading: ExperimentReading }> {
  requirePermission(actor, "pages.view");

  const experiment = await db.experiment.findUnique({
    where: { id },
    select: {
      id: true,
      variants: {
        orderBy: { key: "asc" },
        select: { id: true, key: true, name: true },
      },
    },
  });
  if (!experiment) throw new NotFoundError("That experiment does not exist.");

  const exposures = await db.experimentExposure.findMany({
    where: { experimentId: id },
    select: { variantId: true, visitorId: true },
  });

  const byVariant = new Map<string, string[]>();
  for (const row of exposures) {
    const list = byVariant.get(row.variantId) ?? [];
    list.push(row.visitorId);
    byVariant.set(row.variantId, list);
  }

  const arms: ArmResult[] = [];

  for (const variant of experiment.variants) {
    const visitors = byVariant.get(variant.id) ?? [];

    const conversions =
      visitors.length === 0
        ? 0
        : await db.lead.count({
            where: {
              deletedAt: null,
              OR: [
                { firstTouch: { visitorId: { in: visitors } } },
                { lastTouch: { visitorId: { in: visitors } } },
              ],
            },
          });

    arms.push({
      key: variant.key,
      name: variant.name,
      exposures: visitors.length,
      conversions,
      // Null rather than zero when nobody was exposed: a rate over no people is
      // not a rate of nothing.
      rate: visitors.length === 0 ? null : conversions / visitors.length,
    });
  }

  return { arms, reading: read(arms) };
}

/**
 * The running experiments a page's bands belong to.
 *
 * Read on the public render path, so it is deliberately narrow: only the ids
 * and weights assignment needs.
 */
export async function runningExperimentsFor(
  variantIds: readonly string[],
): Promise<
  Map<string, { experimentId: string; experimentKey: string; variants: { id: string; key: string; weight: number }[] }>
> {
  if (variantIds.length === 0) return new Map();

  const variants = await db.experimentVariant.findMany({
    where: { id: { in: [...variantIds] }, experiment: { status: "RUNNING" } },
    select: {
      id: true,
      experiment: {
        select: {
          id: true,
          key: true,
          variants: { select: { id: true, key: true, weight: true } },
        },
      },
    },
  });

  const map = new Map<
    string,
    { experimentId: string; experimentKey: string; variants: { id: string; key: string; weight: number }[] }
  >();

  for (const variant of variants) {
    map.set(variant.id, {
      experimentId: variant.experiment.id,
      experimentKey: variant.experiment.key,
      variants: variant.experiment.variants,
    });
  }

  return map;
}
