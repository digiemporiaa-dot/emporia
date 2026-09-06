import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { resolvePermissions } from "@/lib/auth/rbac";

/**
 * Session revocation.
 *
 * `currentActor` reads identity from the database on every request and takes
 * only the user id from the JWT. These tests pin the properties that depend on
 * it — a session is an eight-hour token, so anything the token is trusted for
 * is something that cannot be revoked for eight hours.
 *
 * `currentActor` itself needs a request context, so the checks here exercise
 * the database-side facts it reads: status, role and client.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describeDb("session revocation", () => {
  let prisma: PrismaClient;
  const tag = `revoke-${Date.now()}`;
  let userId = "";
  let managerRoleId = "";
  let staffRoleId = "";

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const [manager, staff] = await Promise.all([
      prisma.role.findFirstOrThrow({ where: { name: "SALES_MANAGER" }, select: { id: true } }),
      prisma.role.findFirstOrThrow({ where: { name: "STAFF" }, select: { id: true } }),
    ]);
    managerRoleId = manager.id;
    staffRoleId = staff.id;

    const user = await prisma.user.create({
      data: {
        email: `${tag}@test.local`,
        name: "Revocation Tester",
        type: "STAFF",
        status: "ACTIVE",
        roleId: managerRoleId,
      },
      select: { id: true },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: tag } } });
    await prisma.$disconnect();
  });

  /** What currentActor does with the id it takes from the token. */
  async function liveIdentity(id: string) {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        clientId: true,
        roleId: true,
        role: { select: { name: true } },
      },
    });

    if (!user || user.status !== "ACTIVE") return null;

    return {
      roleName: user.role?.name ?? null,
      clientId: user.clientId,
      permissions: user.roleId ? await resolvePermissions(user.roleId) : new Set<string>(),
    };
  }

  it("gives a suspended account no identity at all", async () => {
    expect(await liveIdentity(userId)).not.toBeNull();

    await prisma.user.update({ where: { id: userId }, data: { status: "SUSPENDED" } });

    // Not "fewer permissions" — no actor, so every guard treats the request as
    // unauthenticated rather than as a signed-in user with nothing granted.
    expect(await liveIdentity(userId)).toBeNull();

    await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
  });

  it("gives a deleted account no identity", async () => {
    expect(await liveIdentity("no-such-user-id")).toBeNull();
  });

  it("applies a role change without the user signing in again", async () => {
    const before = await liveIdentity(userId);
    expect(before?.roleName).toBe("SALES_MANAGER");
    expect(before?.permissions.has("proposals.send")).toBe(true);

    await prisma.user.update({ where: { id: userId }, data: { roleId: staffRoleId } });

    const after = await liveIdentity(userId);
    expect(after?.roleName).toBe("STAFF");
    // The demotion takes effect on the next request, not at token expiry.
    expect(after?.permissions.has("proposals.send")).toBe(false);

    await prisma.user.update({ where: { id: userId }, data: { roleId: managerRoleId } });
  });

  it("reads clientId from the database, so a portal move cannot be stale", async () => {
    const client = await prisma.client.create({
      data: { name: `${tag} client`, slug: `${tag}-client` },
      select: { id: true },
    });

    await prisma.user.update({ where: { id: userId }, data: { clientId: client.id } });
    expect((await liveIdentity(userId))?.clientId).toBe(client.id);

    await prisma.user.update({ where: { id: userId }, data: { clientId: null } });
    expect((await liveIdentity(userId))?.clientId).toBeNull();

    await prisma.client.delete({ where: { id: client.id } });
  });

  it("gives an invited-but-not-activated account no identity", async () => {
    const invited = await prisma.user.create({
      data: {
        email: `invited-${tag}@test.local`,
        name: "Invited",
        type: "STAFF",
        status: "INVITED",
        roleId: staffRoleId,
      },
      select: { id: true },
    });

    expect(await liveIdentity(invited.id)).toBeNull();
  });
});
