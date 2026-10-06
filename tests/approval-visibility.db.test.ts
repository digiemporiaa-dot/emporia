import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getApproval, listApprovals } from "@/lib/services/delivery-content.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Found by the pre-launch audit: approvals are visible through their project
 * or their content item's project, and Prisma's OR over the two nested
 * relation filters matched nothing when the visibility filter was empty — so
 * the people who see every project (super admin, projects.view.team) saw no
 * approvals and could not open one. Restricted users must still see only
 * their own projects' approvals.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `av${Date.now().toString(36)}`;

describeDb("approval visibility", () => {
  let managerId = "";
  let otherId = "";
  let clientId = "";
  const ids: Record<string, string> = {};

  const actor = (userId: string, roleName: string, permissions: string[]): Actor =>
    ({ userId, name: "U", email: "u@x.test", type: "STAFF", roleName, roleId: null, clientId: null, ip: null, userAgent: "vitest", permissions: new Set(permissions) }) as Actor;

  beforeAll(async () => {
    const staff = await db.user.findMany({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true }, take: 2 });
    managerId = staff[0]!.id;
    const roleId = (await db.role.findFirstOrThrow({ where: { name: "STAFF" }, select: { id: true } })).id;
    otherId = (await db.user.create({ data: { email: `other-${TAG}@x.test`, name: "Other", type: "STAFF", status: "ACTIVE", roleId }, select: { id: true } })).id;
    clientId = (await db.client.create({ data: { name: `Client ${TAG}`, slug: `client-${TAG}`, ownerId: managerId }, select: { id: true } })).id;
    const project = await db.project.create({ data: { code: `P-${TAG}`, name: "Website", clientId, managerId, status: "ACTIVE", budget: "1000.00", startsAt: new Date() }, select: { id: true } });
    const item = await db.contentCalendarItem.create({ data: { projectId: project.id, clientId, channel: "INSTAGRAM", title: `Post ${TAG}` }, select: { id: true } });
    ids["viaProject"] = (await db.approval.create({ data: { clientId, projectId: project.id, title: `Homepage ${TAG}`, requestedById: managerId }, select: { id: true } })).id;
    ids["viaItem"] = (await db.approval.create({ data: { clientId, contentItemId: item.id, title: `Post ${TAG}`, requestedById: managerId }, select: { id: true } })).id;
  });

  afterAll(async () => {
    if (!clientId) return;
    await db.approval.deleteMany({ where: { clientId } });
    await db.contentCalendarItem.deleteMany({ where: { clientId } });
    await db.project.deleteMany({ where: { clientId } });
    await db.client.delete({ where: { id: clientId } });
    await db.user.delete({ where: { id: otherId } });
  });

  const mine = async (a: Actor) => (await listApprovals(a)).filter((row) => row.title.endsWith(TAG)).map((row) => row.title).sort();

  it("shows a super admin both kinds of approval, and opens each", async () => {
    const admin = actor(managerId, "SUPER_ADMIN", ["approvals.view"]);
    expect(await mine(admin)).toEqual([`Homepage ${TAG}`, `Post ${TAG}`]);
    expect((await getApproval(admin, ids["viaProject"]!)).id).toBe(ids["viaProject"]);
    expect((await getApproval(admin, ids["viaItem"]!)).id).toBe(ids["viaItem"]);
  });

  it("shows team-wide viewers everything, managers their own, and others nothing", async () => {
    expect(await mine(actor(otherId, "PROJECT_MANAGER", ["approvals.view", "projects.view", "projects.view.team"]))).toHaveLength(2);
    expect(await mine(actor(managerId, "PROJECT_MANAGER", ["approvals.view", "projects.view"]))).toHaveLength(2);
    const outsider = actor(otherId, "STAFF", ["approvals.view", "projects.view"]);
    expect(await mine(outsider)).toEqual([]);
    await expect(getApproval(outsider, ids["viaItem"]!)).rejects.toThrow(/does not exist/);
  });
});
