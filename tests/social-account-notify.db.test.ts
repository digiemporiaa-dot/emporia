import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordSyncResult, warnExpiringAccounts } from "@/lib/services/social-account.service";
import { createSocialContent } from "@/lib/services/social-content.service";
import {
  announceAccountExpiring,
  announceAccountNeedsReconnect,
  announceContentCreated,
} from "@/lib/services/social-notify.service";
import { TRIGGER_FACTS, TRIGGER_LABEL, WIRED_TRIGGERS } from "@/lib/automation/types";
import { encryptSecret } from "@/lib/security/secret";
import type { Actor } from "@/lib/actor/types";
import type { AutomationTriggerType } from "@/generated/prisma/enums";

/**
 * Accounts that are about to stop working, accounts that have stopped, and new
 * content (brief §34 "Account expiring", §35 triggers).
 *
 * Pinned: an account that cannot renew itself is warned about once per expiry
 * date — again after a reconnection, never twice for the same date — and never
 * when it renews itself, is far off, has already lapsed, or is already marked;
 * the change to "needs reconnecting" is announced exactly once, however many
 * paths notice it at the same moment; only staff attached to the client hear;
 * new content fires its trigger with its title and a link to it; and no
 * account fact is a token or a scope.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `acn${Date.now()}`;
const DAY = 86_400_000;

describe("the account and content triggers in the automation vocabulary", () => {
  it("offers each with a label and facts, and no credential among them", () => {
    for (const trigger of ["SOCIAL_ACCOUNT_EXPIRING", "SOCIAL_ACCOUNT_NEEDS_RECONNECT", "SOCIAL_CONTENT_CREATED"] as const) {
      expect(WIRED_TRIGGERS).toContain(trigger);
      expect(TRIGGER_LABEL[trigger]).toBeTruthy();
      const keys = TRIGGER_FACTS[trigger].map((f) => f.key);
      expect(keys).toContain("client.name");
      expect(keys.filter((k) => /token|scope|secret|external/i.test(k))).toEqual([]);
    }
    expect(TRIGGER_FACTS.SOCIAL_ACCOUNT_EXPIRING.map((f) => f.key)).toContain("social.daysLeft");
    expect(TRIGGER_FACTS.SOCIAL_CONTENT_CREATED.map((f) => f.key)).toContain("social.title");
  });
});

describeDb("social account and content notifications", () => {
  let roleId = "";
  let clientId = "";
  let projectId = "";
  const users = { owner: "", connector: "", watcher: "", portal: "" };
  const automationIds: string[] = [];
  let counter = 0;

  const staff = (userId: string, permissions: string[]): Actor => ({
    userId,
    name: "Staff",
    email: "staff@emporia.test",
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  });

  async function user(key: string, type: "STAFF" | "CLIENT" = "STAFF") {
    const created = await db.user.create({
      data: { email: `${TAG}-${key}@emporia.test`, name: key, type, status: "ACTIVE", roleId, clientId: type === "CLIENT" ? clientId : null },
      select: { id: true },
    });
    return created.id;
  }

  async function account(over: { expiresIn?: number | null; refreshToken?: string | null; status?: "CONNECTED" | "NEEDS_RECONNECT" } = {}) {
    counter += 1;
    return (
      await db.socialAccount.create({
        data: {
          clientId,
          provider: "LINKEDIN",
          externalId: `${TAG}-${counter}`,
          name: `${TAG} page ${counter}`,
          status: over.status ?? "CONNECTED",
          accessToken: encryptSecret("access"),
          refreshToken: over.refreshToken ? encryptSecret(over.refreshToken) : null,
          tokenExpiresAt: over.expiresIn === null ? null : new Date(Date.now() + (over.expiresIn ?? 3.5 * DAY)),
          connectedById: users.connector,
        },
        select: { id: true },
      })
    ).id;
  }

  async function rule(trigger: AutomationTriggerType, extra: { field: string; operator: string; value: unknown }[] = []) {
    const created = await db.automation.create({
      data: {
        name: `${TAG} ${trigger}`,
        isActive: true,
        triggers: { create: { type: trigger } },
        conditions: {
          create: [
            { field: "client.name", operator: "eq", value: `${TAG} client`, order: 0 },
            ...extra.map((c, i) => ({ field: c.field, operator: c.operator, value: c.value as never, order: i + 1 })),
          ],
        },
        actions: { create: { type: "NOTIFY_USER", config: { to: "SPECIFIC", userId: users.watcher, title: `${TAG} rule ${trigger} {{social.accountName}}{{social.title}}` } } },
      },
      select: { id: true },
    });
    automationIds.push(created.id);
  }

  const fired = (trigger: AutomationTriggerType) =>
    db.notification.findMany({
      where: { userId: users.watcher, title: { startsWith: `${TAG} rule ${trigger}` } },
      select: { title: true, href: true, entityType: true, entityId: true },
    });
  const inbox = (userId: string, entityId: string) =>
    db.notification.findMany({ where: { userId, entityId }, select: { title: true, body: true, href: true } });

  beforeAll(async () => {
    roleId = (await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { roleId: true } })).roleId;
    users.owner = await user("owner");
    users.connector = await user("connector");
    users.watcher = await user("watcher");
    clientId = (
      await db.client.create({ data: { name: `${TAG} client`, slug: `${TAG}-a`, ownerId: users.owner }, select: { id: true } })
    ).id;
    users.portal = await user("portal", "CLIENT");
    projectId = (
      await db.project.create({
        data: { code: `N-${TAG}`.slice(0, 20), name: "Retainer", clientId, managerId: users.owner, startsAt: new Date(), status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
  });

  afterEach(async () => {
    await db.automation.deleteMany({ where: { id: { in: automationIds.splice(0) } } });
  });

  afterAll(async () => {
    const userIds = Object.values(users).filter(Boolean);
    await db.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.socialPost.deleteMany({ where: { clientId } });
    await db.contentCalendarItem.deleteMany({ where: { clientId } });
    await db.socialAccount.deleteMany({ where: { clientId } });
    await db.project.deleteMany({ where: { clientId } });
    await db.client.deleteMany({ where: { id: clientId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("warns the client's owner and the connector once about access running out, and fires its trigger", async () => {
    await rule("SOCIAL_ACCOUNT_EXPIRING", [{ field: "social.daysLeft", operator: "lte", value: 3 }]);
    const id = await account();
    const item = await db.contentCalendarItem.create({
      data: { clientId, projectId, title: `${TAG} idea`, channel: "LINKEDIN", stage: "APPROVED" },
      select: { id: true },
    });
    await db.socialPost.create({
      data: { contentItemId: item.id, clientId, accountId: id, provider: "LINKEDIN", type: "TEXT", status: "SCHEDULED", caption: "Copy.", scheduledFor: new Date(Date.now() + DAY) },
    });

    await warnExpiringAccounts();
    for (const userId of [users.owner, users.connector]) {
      const [sent, ...rest] = await inbox(userId, id);
      expect(rest).toEqual([]);
      expect(sent).toMatchObject({ title: "LinkedIn access expires in 3 days", href: `/admin/clients/${clientId}/social/accounts` });
      expect(sent!.body).toContain(`${TAG} page`);
      expect(sent!.body).toContain("1 scheduled post uses it.");
    }
    // Staff only: a client is never told about tokens.
    expect(await db.notification.count({ where: { userId: users.portal } })).toBe(0);
    const rules = await fired("SOCIAL_ACCOUNT_EXPIRING");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ href: `/admin/clients/${clientId}/social/accounts`, entityType: "SocialAccount", entityId: id });
    expect(rules[0]!.title).toContain(`${TAG} page`);

    // The next cron run, the same expiry: nothing new.
    await warnExpiringAccounts();
    expect(await inbox(users.owner, id)).toHaveLength(1);
    expect(await fired("SOCIAL_ACCOUNT_EXPIRING")).toHaveLength(1);

    // Reconnected with a token that is itself close to its end: warned again.
    await db.socialAccount.update({ where: { id }, data: { tokenExpiresAt: new Date(Date.now() + 2.5 * DAY) } });
    await warnExpiringAccounts();
    expect((await inbox(users.owner, id)).map((n) => n.title).sort()).toEqual([
      "LinkedIn access expires in 2 days",
      "LinkedIn access expires in 3 days",
    ]);
  });

  it("does not warn about accounts that renew themselves, are far off, have lapsed or are already marked", async () => {
    const ids = [
      await account({ refreshToken: "refresh" }),
      await account({ expiresIn: 10 * DAY }),
      await account({ expiresIn: -DAY }),
      await account({ expiresIn: null }),
      await account({ status: "NEEDS_RECONNECT" }),
    ];
    await warnExpiringAccounts();
    expect(await db.notification.count({ where: { entityId: { in: ids } } })).toBe(0);
  });

  it("announces the change to needs-reconnecting exactly once, even when two paths notice together", async () => {
    await rule("SOCIAL_ACCOUNT_NEEDS_RECONNECT");
    const id = await account({ expiresIn: 30 * DAY });
    await Promise.all([
      recordSyncResult(id, { ok: false, error: "LinkedIn rejected the credentials.", credentialsRejected: true }),
      recordSyncResult(id, { ok: false, error: "LinkedIn rejected the credentials.", credentialsRejected: true }),
    ]);
    expect((await db.socialAccount.findUniqueOrThrow({ where: { id } })).status).toBe("NEEDS_RECONNECT");
    const [sent, ...rest] = await inbox(users.connector, id);
    expect(rest).toEqual([]);
    expect(sent).toMatchObject({ title: "LinkedIn account needs reconnecting" });
    expect(sent!.body).toContain("rejected the credentials");
    expect(await fired("SOCIAL_ACCOUNT_NEEDS_RECONNECT")).toHaveLength(1);

    // Already marked: a further failure changes nothing and tells nobody.
    await recordSyncResult(id, { ok: false, error: "Still rejected.", credentialsRejected: true });
    expect(await inbox(users.connector, id)).toHaveLength(1);
  });

  it("announces repeated failures only when they cross the threshold", async () => {
    const id = await account({ expiresIn: 30 * DAY });
    await recordSyncResult(id, { ok: false, error: "Timed out." });
    await recordSyncResult(id, { ok: false, error: "Timed out." });
    expect(await inbox(users.owner, id)).toEqual([]);
    await recordSyncResult(id, { ok: false, error: "Timed out." });
    expect(await inbox(users.owner, id)).toHaveLength(1);
  });

  it("fires the content trigger with the new idea's title and a link to it", async () => {
    await rule("SOCIAL_CONTENT_CREATED", [{ field: "social.title", operator: "contains", value: "Diwali" }]);
    const { id } = await createSocialContent(staff(users.owner, ["social.view", "social.create"]), {
      clientId,
      projectId,
      title: `${TAG} Diwali teaser`,
      brief: null,
      campaignId: null,
      ownerId: users.owner,
      scheduledFor: null,
    });
    const rules = await fired("SOCIAL_CONTENT_CREATED");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      title: `${TAG} rule SOCIAL_CONTENT_CREATED ${TAG} Diwali teaser`,
      href: `/admin/clients/${clientId}/social/content/${id}`,
      entityType: "ContentCalendarItem",
      entityId: id,
    });
    // Creating is routine: nobody is notified outside the rules they wrote.
    expect(await db.notification.count({ where: { entityId: id, userId: { not: users.watcher } } })).toBe(0);
  });

  it("never throws, whatever it is handed", async () => {
    await expect(announceAccountExpiring("does-not-exist", 3)).resolves.toBeUndefined();
    await expect(announceAccountNeedsReconnect("does-not-exist", "x")).resolves.toBeUndefined();
    await expect(announceContentCreated("does-not-exist", users.owner)).resolves.toBeUndefined();
  });
});
