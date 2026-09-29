import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { publishDuePosts, type ResolveAdapter } from "@/lib/services/social-publish.service";
import { usableCredentials } from "@/lib/services/social-account.service";
import { XProvider } from "@/lib/social/x";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { decryptSecret, encryptSecret } from "@/lib/security/secret";
import { startXDouble, type XDouble } from "./support/x-double";

/**
 * X inside the application, and the race X's refresh tokens make real.
 *
 * An X refresh token works once. Two renewals of the same account at the same
 * moment — an overlapping cron run, the Check button pressed mid-run — used
 * to both present it; X honoured one and refused the other, and the refusal
 * marked a healthy account for reconnection. Renewal is now one at a time per
 * account, and the second caller uses what the first obtained.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const SUFFIX = `x-${Date.now()}`;

describeDb("X through the engine, and renewing single-use refresh tokens", () => {
  let double: XDouble;
  let adapter: XProvider;
  let resolve: ResolveAdapter;
  let clientId = "";
  let projectId = "";

  beforeAll(async () => {
    double = await startXDouble();
    adapter = new XProvider({
      clientId: "x-client",
      clientSecret: "x-secret",
      apiBase: double.url,
      timeoutMs: 3_000,
      maxPollIntervalMs: 20,
    });
    resolve = async (which) => (which === "X" ? adapter : new UnconfiguredSocialProvider(which));

    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    const client = await db.client.create({ data: { name: `${SUFFIX} Northwind`, slug: `${SUFFIX}-a` }, select: { id: true } });
    clientId = client.id;
    const project = await db.project.create({
      data: { code: `X-${SUFFIX}`.slice(0, 20), name: "Retainer", clientId, managerId: user.id, startsAt: new Date(), status: "ACTIVE" },
      select: { id: true },
    });
    projectId = project.id;
  });

  async function xAccount(refreshToken: string) {
    return db.socialAccount.create({
      data: {
        clientId,
        provider: "X",
        externalId: `${SUFFIX}-4401-${refreshToken}`,
        name: "Northwind Studio",
        username: "northwind",
        status: "CONNECTED",
        accessToken: encryptSecret("x-access-old"),
        refreshToken: encryptSecret(refreshToken),
        // A two-hour token with ten minutes left.
        tokenExpiresAt: new Date(Date.now() + 10 * 60_000),
      },
      select: { id: true },
    });
  }

  afterEach(async () => {
    double.refreshDelay(0);
    await db.socialPublication.deleteMany({ where: { clientId } });
    await db.socialPost.deleteMany({ where: { clientId } });
    await db.contentCalendarItem.deleteMany({ where: { clientId } });
    await db.socialAccount.deleteMany({ where: { clientId } });
  });

  afterAll(async () => {
    await double.close();
    await db.project.deleteMany({ where: { clientId } });
    await db.client.deleteMany({ where: { id: clientId } });
  });

  it("renews, stores the rotated refresh token, and posts", async () => {
    const account = await xAccount("x-refresh-100");
    const item = await db.contentCalendarItem.create({
      data: { clientId, projectId, title: `${SUFFIX} hours`, channel: "INSTAGRAM", stage: "APPROVED" },
      select: { id: true },
    });
    const post = await db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId,
        accountId: account.id,
        provider: "X",
        type: "TEXT",
        status: "SCHEDULED",
        caption: "Festive hours this week: 10am to 9pm.",
        scheduledFor: new Date(Date.now() - 60_000),
      },
      select: { id: true },
    });

    const run = await publishDuePosts(new Date(), resolve);
    expect(run.published).toBe(1);

    const row = await db.socialPost.findUniqueOrThrow({ where: { id: post.id }, select: { status: true, externalPostId: true } });
    expect(row).toEqual({ status: "PUBLISHED", externalPostId: "1790000000000000001" });

    const stored = await db.socialAccount.findUniqueOrThrow({ where: { id: account.id }, select: { refreshToken: true, status: true } });
    // The old one is spent at X; keeping it would kill the account at the
    // next renewal.
    expect(decryptSecret(stored.refreshToken!)).not.toBe("x-refresh-100");
    expect(stored.status).toBe("CONNECTED");
  });

  it("renews once when two callers race, and both get a working token", async () => {
    const account = await xAccount("x-refresh-200");
    double.refreshDelay(300);
    const before = double.refreshCount();

    const [a, b] = await Promise.all([
      usableCredentials(account.id, adapter),
      usableCredentials(account.id, adapter),
    ]);

    expect(double.refreshCount() - before).toBe(1);
    expect(a?.accessToken).toBeTruthy();
    expect(b?.accessToken).toBe(a?.accessToken);
    const stored = await db.socialAccount.findUniqueOrThrow({ where: { id: account.id }, select: { status: true, lastSyncError: true } });
    expect(stored).toEqual({ status: "CONNECTED", lastSyncError: null });
  });
});
