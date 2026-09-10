import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { setPageSchedule } from "@/lib/services/page.service";
import { runScheduledPublishing, schedulerActor } from "@/lib/services/schedule.service";
import { listVersions } from "@/lib/services/page-version.service";
import { pageScheduleSchema } from "@/lib/validation/page";
import type { Actor } from "@/lib/actor/types";

/**
 * Scheduled publishing.
 *
 * The scheduler is a pull: it asks what is due and acts. What matters is that
 * it goes through the same publish path as a person — taking a version, writing
 * an audit row — that it fires once, that it never resurrects something
 * archived, and that one bad page does not hold back everyone else's launch.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `sch-${Date.now()}`;
const HOUR = 60 * 60 * 1000;

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

describeDb("scheduled publishing", () => {
  const pages: string[] = [];
  let editor: Actor;
  let publisher: Actor;

  beforeEach(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    editor = actorWith(staff.id, ["pages.view", "pages.edit"]);
    publisher = actorWith(staff.id, ["pages.view", "pages.edit", "pages.publish"]);
  });

  afterAll(async () => {
    await db.page.deleteMany({ where: { id: { in: pages } } });
  });

  async function newPage(data: {
    status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    publishAt?: Date | null;
    unpublishAt?: Date | null;
  }) {
    const page = await db.page.create({
      data: {
        slug: `sched-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
        title: "A scheduled page",
        status: data.status ?? "DRAFT",
        publishAt: data.publishAt ?? null,
        unpublishAt: data.unpublishAt ?? null,
        sections: {
          create: [{ type: "richText", order: 0, content: { body: "Hello", version: 1 } }],
        },
      },
      select: { id: true },
    });
    pages.push(page.id);
    return page.id;
  }

  const statusOf = async (id: string) =>
    (await db.page.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

  // -------------------------------------------------------------------------
  // The run
  // -------------------------------------------------------------------------

  it("publishes a page whose time has come, and takes a version doing it", async () => {
    const id = await newPage({ publishAt: new Date(Date.now() - HOUR) });

    const run = await runScheduledPublishing();
    expect(run.published.map((p) => p.id)).toContain(id);
    expect(await statusOf(id)).toBe("PUBLISHED");

    // The same path a person's publish takes, so history is not a special case.
    const versions = await listVersions(publisher, id);
    expect(versions[0]?.reason).toBe("Published");
  });

  it("clears publishAt so a scheduled publish happens once", async () => {
    const id = await newPage({ publishAt: new Date(Date.now() - HOUR) });
    await runScheduledPublishing();

    const page = await db.page.findUniqueOrThrow({ where: { id }, select: { publishAt: true } });
    expect(page.publishAt).toBeNull();

    // Unpublished by hand, it must not silently go live again.
    await db.page.update({ where: { id }, data: { status: "DRAFT" } });
    const second = await runScheduledPublishing();
    expect(second.published.map((p) => p.id)).not.toContain(id);
  });

  it("leaves a page whose time has not come", async () => {
    const id = await newPage({ publishAt: new Date(Date.now() + HOUR) });
    await runScheduledPublishing();
    expect(await statusOf(id)).toBe("DRAFT");
  });

  it("takes a page down at its end time", async () => {
    const id = await newPage({ status: "PUBLISHED", unpublishAt: new Date(Date.now() - HOUR) });

    const run = await runScheduledPublishing();
    expect(run.unpublished.map((p) => p.id)).toContain(id);
    expect(await statusOf(id)).toBe("DRAFT");
  });

  it("keeps unpublishAt, so a page put back by hand still comes down again", async () => {
    const id = await newPage({ status: "PUBLISHED", unpublishAt: new Date(Date.now() - HOUR) });
    await runScheduledPublishing();

    const page = await db.page.findUniqueOrThrow({ where: { id }, select: { unpublishAt: true } });
    expect(page.unpublishAt).not.toBeNull();
  });

  it("ends a whole window that has already passed in the down position", async () => {
    // Scheduled up on Monday and down on Friday, and nobody ran the job until
    // Saturday. Processing unpublishes first would leave it live.
    const id = await newPage({
      publishAt: new Date(Date.now() - 3 * HOUR),
      unpublishAt: new Date(Date.now() - HOUR),
    });

    await runScheduledPublishing();
    expect(await statusOf(id)).toBe("DRAFT");
  });

  it("never resurrects something archived", async () => {
    const id = await newPage({ status: "ARCHIVED", publishAt: new Date(Date.now() - HOUR) });
    await runScheduledPublishing();
    expect(await statusOf(id)).toBe("ARCHIVED");
  });

  it("ignores a soft-deleted page", async () => {
    const id = await newPage({ publishAt: new Date(Date.now() - HOUR) });
    await db.page.update({ where: { id }, data: { deletedAt: new Date() } });

    const run = await runScheduledPublishing();
    expect(run.published.map((p) => p.id)).not.toContain(id);
  });

  it("does nothing at all when nothing is due", async () => {
    const run = await runScheduledPublishing(new Date(Date.now() - 365 * 24 * HOUR));
    expect(run.published).toHaveLength(0);
    expect(run.unpublished).toHaveLength(0);
    expect(run.failed).toHaveLength(0);
  });

  it("is safe to run twice — the second finds nothing left", async () => {
    const id = await newPage({ publishAt: new Date(Date.now() - HOUR) });
    await runScheduledPublishing();
    const second = await runScheduledPublishing();
    expect(second.published.map((p) => p.id)).not.toContain(id);
    expect(await statusOf(id)).toBe("PUBLISHED");
  });

  it("acts as a scheduler with exactly the permissions the job needs", () => {
    const actor = schedulerActor();
    expect(actor.type).toBe("SYSTEM");
    expect(actor.permissions.has("pages.publish")).toBe(true);
    // Not a blanket bypass: it can publish a page, not delete a client.
    expect(actor.permissions.has("clients.delete")).toBe(false);
    expect(actor.roleName).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Setting a schedule
  // -------------------------------------------------------------------------

  it("needs pages.publish to schedule, because scheduling is publishing later", async () => {
    const id = await newPage({});
    await expect(
      setPageSchedule(editor, id, { publishAt: new Date(), unpublishAt: null }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("stores and clears a schedule", async () => {
    const id = await newPage({});
    const when = new Date(Date.now() + HOUR);

    await setPageSchedule(publisher, id, { publishAt: when, unpublishAt: null });
    let page = await db.page.findUniqueOrThrow({ where: { id }, select: { publishAt: true } });
    expect(page.publishAt?.toISOString()).toBe(when.toISOString());

    await setPageSchedule(publisher, id, { publishAt: null, unpublishAt: null });
    page = await db.page.findUniqueOrThrow({ where: { id }, select: { publishAt: true } });
    expect(page.publishAt).toBeNull();
  });

  it("audits a schedule change", async () => {
    const id = await newPage({});
    await setPageSchedule(publisher, id, { publishAt: new Date(Date.now() + HOUR), unpublishAt: null });

    const entries = await db.auditLog.count({
      where: { entityType: "Page schedule", entityId: id },
    });
    expect(entries).toBe(1);
  });
});

describe("schedule validation", () => {
  it("accepts a blank pair as 'no schedule'", () => {
    const parsed = pageScheduleSchema.parse({ publishAt: "", unpublishAt: "" });
    expect(parsed).toEqual({ publishAt: null, unpublishAt: null });
  });

  it("reads an ISO string into a date", () => {
    const parsed = pageScheduleSchema.parse({
      publishAt: "2026-09-15T09:00:00.000Z",
      unpublishAt: "",
    });
    expect(parsed.publishAt?.toISOString()).toBe("2026-09-15T09:00:00.000Z");
  });

  it("refuses a page that comes down before it goes up", () => {
    const result = pageScheduleSchema.safeParse({
      publishAt: "2026-09-15T09:00:00.000Z",
      unpublishAt: "2026-09-14T09:00:00.000Z",
    });
    expect(result.success).toBe(false);
    expect(result.success ? "" : result.error.issues[0]?.path.join(".")).toBe("unpublishAt");
  });

  it("accepts a time in the past — it fires on the next run", () => {
    // "Publish it at nine", set at five past nine, should publish.
    expect(pageScheduleSchema.safeParse({ publishAt: "2020-01-01T00:00:00.000Z" }).success).toBe(
      true,
    );
  });

  it("refuses something that is not a date at all", () => {
    expect(pageScheduleSchema.safeParse({ publishAt: "next tuesday" }).success).toBe(false);
  });
});

