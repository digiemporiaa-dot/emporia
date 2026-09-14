import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  createExperiment,
  deleteExperiment,
  experimentResults,
  recordExposure,
  runningExperimentsFor,
  setExperimentStatus,
  setSectionVariant,
} from "@/lib/services/experiment.service";
import { experimentSchema } from "@/lib/validation/experiment";
import type { Actor } from "@/lib/actor/types";

/**
 * Experiments, end to end.
 *
 * The properties that matter: a visitor counts once towards a sample however
 * many times they reload; a draft or stopped test never leaks its variant onto
 * the live site; and the record of what people were shown cannot be deleted to
 * tidy a list.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `ex-${Date.now()}`;

function actorWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Editor",
    email: null,
    type: "STAFF",
    roleName: "CONTENT_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

describe("experiment validation", () => {
  it("insists on exactly two arms", () => {
    const base = { key: "hero", name: "Hero" };
    const arm = (key: string) => ({ key, name: key, weight: 1 });

    expect(experimentSchema.safeParse({ ...base, variants: [arm("a")] }).success).toBe(false);
    expect(
      experimentSchema.safeParse({ ...base, variants: [arm("a"), arm("b"), arm("c")] }).success,
    ).toBe(false);
    expect(experimentSchema.safeParse({ ...base, variants: [arm("a"), arm("b")] }).success).toBe(
      true,
    );
  });

  it("refuses a handle with spaces or capitals", () => {
    const variants = [
      { key: "control", name: "Control", weight: 1 },
      { key: "b", name: "B", weight: 1 },
    ];
    expect(experimentSchema.safeParse({ key: "Hero Test", name: "Hero", variants }).success).toBe(
      false,
    );
  });
});

describeDb("experiments", () => {
  const made: string[] = [];
  const pages: string[] = [];
  let publisher: Actor;
  let editor: Actor;

  beforeAll(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    publisher = actorWith(staff.id, ["pages.view", "pages.edit", "pages.publish"]);
    editor = actorWith(staff.id, ["pages.view", "pages.edit"]);
  });

  afterAll(async () => {
    await db.pageSection.deleteMany({ where: { pageId: { in: pages } } });
    await db.page.deleteMany({ where: { id: { in: pages } } });
    await db.experiment.deleteMany({ where: { id: { in: made } } });
  });

  async function newExperiment(over: { key?: string } = {}) {
    const created = await createExperiment(publisher, {
      key: over.key ?? `${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
      name: "A test",
      hypothesis: "A shorter hero produces more enquiries.",
      variants: [
        { key: "control", name: "Control", weight: 1 },
        { key: "variant", name: "Variant", weight: 1 },
      ],
    });
    made.push(created.id);
    const full = await db.experiment.findUniqueOrThrow({
      where: { id: created.id },
      select: { id: true, key: true, variants: { orderBy: { key: "asc" }, select: { id: true, key: true } } },
    });
    return full;
  }

  async function newPage() {
    const page = await db.page.create({
      data: {
        slug: `ex-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
        title: "A tested page",
        status: "PUBLISHED",
        sections: {
          create: [{ type: "richText", order: 0, content: { body: "A band." } }],
        },
      },
      select: { id: true, sections: { select: { id: true } } },
    });
    pages.push(page.id);
    return page;
  }

  // -------------------------------------------------------------------------
  // Managing
  // -------------------------------------------------------------------------

  it("creates both arms with the experiment", async () => {
    const experiment = await newExperiment();
    expect(experiment.variants.map((v) => v.key)).toEqual(["control", "variant"]);
  });

  it("needs pages.publish to create one", async () => {
    await expect(
      createExperiment(editor, {
        key: `${SUFFIX}-denied`,
        name: "Denied",
        variants: [
          { key: "control", name: "Control", weight: 1 },
          { key: "variant", name: "Variant", weight: 1 },
        ],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a handle already in use", async () => {
    const first = await newExperiment();
    await expect(newExperiment({ key: first.key })).rejects.toBeInstanceOf(ConflictError);
  });

  it("records when it started, once", async () => {
    const experiment = await newExperiment();
    await setExperimentStatus(publisher, experiment.id, "RUNNING");
    const started = await db.experiment.findUniqueOrThrow({
      where: { id: experiment.id },
      select: { startedAt: true },
    });
    expect(started.startedAt).not.toBeNull();

    await setExperimentStatus(publisher, experiment.id, "STOPPED");
    await setExperimentStatus(publisher, experiment.id, "RUNNING");
    const again = await db.experiment.findUniqueOrThrow({
      where: { id: experiment.id },
      select: { startedAt: true },
    });
    expect(again.startedAt?.getTime()).toBe(started.startedAt?.getTime());
  });

  it("refuses to put a test that has run back into draft", async () => {
    // It would leave exposures attached to a test claiming never to have run.
    const experiment = await newExperiment();
    await setExperimentStatus(publisher, experiment.id, "RUNNING");
    await expect(
      setExperimentStatus(publisher, experiment.id, "DRAFT"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // -------------------------------------------------------------------------
  // Exposures
  // -------------------------------------------------------------------------

  it("counts a visitor once however many times they are recorded", async () => {
    const experiment = await newExperiment();
    const arm = experiment.variants[0]!;

    for (let i = 0; i < 5; i += 1) {
      await recordExposure({
        experimentId: experiment.id,
        variantId: arm.id,
        visitorId: `${SUFFIX}-repeat`,
      });
    }

    const count = await db.experimentExposure.count({ where: { experimentId: experiment.id } });
    expect(count).toBe(1);
  });

  it("counts different visitors separately", async () => {
    const experiment = await newExperiment();
    const arm = experiment.variants[0]!;

    for (let i = 0; i < 3; i += 1) {
      await recordExposure({
        experimentId: experiment.id,
        variantId: arm.id,
        visitorId: `${SUFFIX}-v${i}`,
      });
    }

    expect(await db.experimentExposure.count({ where: { experimentId: experiment.id } })).toBe(3);
  });

  it("never throws, because a sample is not worth a 500 to a visitor", async () => {
    await expect(
      recordExposure({
        experimentId: "cnosuchexperiment000000",
        variantId: "cnosuchvariant000000000",
        visitorId: "someone",
      }),
    ).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // The live site
  // -------------------------------------------------------------------------

  it("does not report a draft experiment as running", async () => {
    // A draft test must not leak its variant onto the live site.
    const experiment = await newExperiment();
    const arm = experiment.variants[0]!;
    expect((await runningExperimentsFor([arm.id])).size).toBe(0);
  });

  it("reports a running experiment, with both arms and their weights", async () => {
    const experiment = await newExperiment();
    await setExperimentStatus(publisher, experiment.id, "RUNNING");
    const arm = experiment.variants[0]!;

    const running = await runningExperimentsFor([arm.id]);
    expect(running.size).toBe(1);
    expect(running.get(arm.id)?.variants).toHaveLength(2);
  });

  it("stops reporting it once the test is stopped", async () => {
    const experiment = await newExperiment();
    await setExperimentStatus(publisher, experiment.id, "RUNNING");
    await setExperimentStatus(publisher, experiment.id, "STOPPED");

    expect((await runningExperimentsFor([experiment.variants[0]!.id])).size).toBe(0);
  });

  it("attaches a band to an arm, and detaches it", async () => {
    const experiment = await newExperiment();
    const page = await newPage();
    const sectionId = page.sections[0]!.id;

    await setSectionVariant(publisher, sectionId, experiment.variants[0]!.id);
    let section = await db.pageSection.findUniqueOrThrow({
      where: { id: sectionId },
      select: { variantId: true },
    });
    expect(section.variantId).toBe(experiment.variants[0]!.id);

    await setSectionVariant(publisher, sectionId, null);
    section = await db.pageSection.findUniqueOrThrow({
      where: { id: sectionId },
      select: { variantId: true },
    });
    expect(section.variantId).toBeNull();
  });

  it("refuses to attach a band to an arm that does not exist", async () => {
    const page = await newPage();
    await expect(
      setSectionVariant(publisher, page.sections[0]!.id, "cnosucharm000000000000"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  // -------------------------------------------------------------------------
  // Reading the result
  // -------------------------------------------------------------------------

  it("reports no verdict for a test nobody has seen", async () => {
    const experiment = await newExperiment();
    const { arms, reading } = await experimentResults(publisher, experiment.id);
    expect(arms.every((arm) => arm.exposures === 0)).toBe(true);
    // A rate over nobody is not zero per cent.
    expect(arms.every((arm) => arm.rate === null)).toBe(true);
    expect(reading.state).toBe("no-data");
  });

  it("refuses a verdict on a small sample, and says how far off it is", async () => {
    const experiment = await newExperiment();
    for (const [index, arm] of experiment.variants.entries()) {
      for (let i = 0; i < 5; i += 1) {
        await recordExposure({
          experimentId: experiment.id,
          variantId: arm.id,
          visitorId: `${SUFFIX}-small-${index}-${i}`,
        });
      }
    }

    const { reading } = await experimentResults(publisher, experiment.id);
    expect(reading.state).toBe("too-early");
    expect(reading.state === "too-early" && reading.needed).toMatch(/95 more visitors/);
  });

  // -------------------------------------------------------------------------
  // Deleting
  // -------------------------------------------------------------------------

  it("refuses to delete a test people have seen", async () => {
    // Those rows are the only record of what the site showed them.
    const experiment = await newExperiment();
    await recordExposure({
      experimentId: experiment.id,
      variantId: experiment.variants[0]!.id,
      visitorId: `${SUFFIX}-witness`,
    });

    await expect(deleteExperiment(publisher, experiment.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(deleteExperiment(publisher, experiment.id)).rejects.toThrow(/Stop it instead/);
  });

  it("deletes one nobody has seen", async () => {
    const experiment = await newExperiment();
    await expect(deleteExperiment(publisher, experiment.id)).resolves.toMatchObject({
      id: experiment.id,
    });
  });
});
