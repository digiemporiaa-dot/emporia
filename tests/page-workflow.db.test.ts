import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { setPageWorkflow } from "@/lib/services/page.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Editorial workflow.
 *
 * Two rules carry the weight. Deciding on a review — approving, or asking for
 * changes — needs `pages.publish`, because approving is the judgement that
 * precedes publishing and should not be self-service. And the transitions are a
 * graph rather than a free-for-all: a page cannot be approved without having
 * been submitted.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `wf-${Date.now()}`;

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

describeDb("page workflow", () => {
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

  async function newPage() {
    const page = await db.page.create({
      data: {
        slug: `wf-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
        title: "A page in review",
        status: "DRAFT",
      },
      select: { id: true, workflow: true },
    });
    pages.push(page.id);
    return page.id;
  }

  it("starts every page in progress, including ones that predate this", async () => {
    const id = await newPage();
    const page = await db.page.findUniqueOrThrow({ where: { id }, select: { workflow: true } });
    expect(page.workflow).toBe("DRAFT");
  });

  it("lets an editor submit for review and withdraw again", async () => {
    const id = await newPage();
    expect((await setPageWorkflow(editor, id, "IN_REVIEW")).workflow).toBe("IN_REVIEW");
    expect((await setPageWorkflow(editor, id, "DRAFT")).workflow).toBe("DRAFT");
  });

  it("refuses to let an editor approve their own work", async () => {
    const id = await newPage();
    await setPageWorkflow(editor, id, "IN_REVIEW");
    await expect(setPageWorkflow(editor, id, "APPROVED")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setPageWorkflow(editor, id, "CHANGES_REQUESTED")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("lets a publisher approve, or ask for changes with a note", async () => {
    const id = await newPage();
    await setPageWorkflow(editor, id, "IN_REVIEW");
    await setPageWorkflow(publisher, id, "CHANGES_REQUESTED", "The second band reads oddly.");

    const page = await db.page.findUniqueOrThrow({
      where: { id },
      select: { workflow: true, reviewNote: true },
    });
    expect(page.workflow).toBe("CHANGES_REQUESTED");
    expect(page.reviewNote).toBe("The second band reads oddly.");
  });

  it("clears the note on resubmission, so it does not hang over redone work", async () => {
    const id = await newPage();
    await setPageWorkflow(editor, id, "IN_REVIEW");
    await setPageWorkflow(publisher, id, "CHANGES_REQUESTED", "Fix the heading.");
    await setPageWorkflow(editor, id, "IN_REVIEW");

    const page = await db.page.findUniqueOrThrow({ where: { id }, select: { reviewNote: true } });
    expect(page.reviewNote).toBeNull();
  });

  it("refuses a jump the process does not allow", async () => {
    const id = await newPage();
    // Approving something nobody submitted skips the whole point.
    await expect(setPageWorkflow(publisher, id, "APPROVED")).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses a move to where it already is, rather than silently doing nothing", async () => {
    const id = await newPage();
    await expect(setPageWorkflow(editor, id, "DRAFT")).rejects.toBeInstanceOf(ConflictError);
  });

  it("walks the whole path", async () => {
    const id = await newPage();
    await setPageWorkflow(editor, id, "IN_REVIEW");
    await setPageWorkflow(publisher, id, "CHANGES_REQUESTED", "Nearly.");
    await setPageWorkflow(editor, id, "IN_REVIEW");
    const approved = await setPageWorkflow(publisher, id, "APPROVED", "Good to go.");
    expect(approved.workflow).toBe("APPROVED");
  });

  it("audits every transition", async () => {
    const id = await newPage();
    await setPageWorkflow(editor, id, "IN_REVIEW");
    await setPageWorkflow(publisher, id, "APPROVED");

    const entries = await db.auditLog.count({
      where: { entityType: "Page workflow", entityId: id },
    });
    expect(entries).toBe(2);
  });
});
