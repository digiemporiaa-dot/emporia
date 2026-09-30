import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { savePost } from "@/lib/services/social-post.service";
import { recordSyncResult, usableCredentials } from "@/lib/services/social-account.service";
import { socialPostSchema } from "@/lib/validation/social";
import { LinkedInProvider } from "@/lib/social/linkedin";
import { encryptSecret } from "@/lib/security/secret";
import { startLinkedInDouble, type LinkedInDouble } from "./support/linkedin-double";
import type { Actor } from "@/lib/actor/types";

/**
 * The audit trail the brief lists (§37) for the cases that were missing:
 * a post's time moved in the editor, credentials renewed, and an account
 * marked for reconnection. Pinned: each is recorded, the automatic ones by the
 * system, and no token ever reaches the row.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `aud${Date.now()}`;

describeDb("social audit trail", () => {
  let li: LinkedInDouble;
  let linkedin: LinkedInProvider;
  let editor: Actor;
  let clientId = "";
  let projectId = "";
  let accountId = "";

  beforeAll(async () => {
    li = await startLinkedInDouble();
    linkedin = new LinkedInProvider({ clientId: "li-app", clientSecret: "li-secret", authBase: `${li.url}/oauth/v2`, apiBase: `${li.url}/v2`, restBase: `${li.url}/rest` });
    const user = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    editor = {
      userId: user.id,
      name: "Editor",
      email: "e@emporia.test",
      type: "STAFF",
      roleName: "CONTENT_MANAGER",
      roleId: null,
      clientId: null,
      permissions: new Set(["social.view", "social.create", "social.edit"]),
      ip: null,
      userAgent: "vitest",
    };
    clientId = (await db.client.create({ data: { name: `${TAG} client`, slug: `${TAG}-a` }, select: { id: true } })).id;
    projectId = (
      await db.project.create({
        data: { code: `A-${TAG}`.slice(0, 20), name: "Retainer", clientId, managerId: user.id, startsAt: new Date(), status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    accountId = (
      await db.socialAccount.create({
        data: { clientId, provider: "LINKEDIN", externalId: `${TAG}-li`, name: "On LinkedIn", status: "CONNECTED", accessToken: encryptSecret("li-access-token") },
        select: { id: true },
      })
    ).id;
  });

  afterAll(async () => {
    if (clientId) {
      await db.socialPost.deleteMany({ where: { clientId } });
      await db.contentCalendarItem.deleteMany({ where: { clientId } });
      await db.socialAccount.deleteMany({ where: { clientId } });
      await db.project.deleteMany({ where: { clientId } });
      await db.client.deleteMany({ where: { id: clientId } });
    }
    await li?.close();
  });

  it("records a post's time moved in the editor, and that its words did not change", async () => {
    const item = await db.contentCalendarItem.create({
      data: { clientId, projectId, title: `${TAG} idea`, channel: "LINKEDIN", stage: "DRAFT" },
      select: { id: true },
    });
    const first = new Date("2026-11-03T05:30:00Z");
    const moved = new Date("2026-11-05T09:00:00Z");
    const input = (scheduledFor: Date) =>
      socialPostSchema.parse({ contentItemId: item.id, provider: "LINKEDIN", type: "TEXT", caption: "Diwali offer for new teams.", accountId, scheduledFor });
    const { id } = await savePost(editor, null, input(first));
    await savePost(editor, id, input(moved));

    const entry = await db.auditLog.findFirstOrThrow({
      where: { entityType: "SocialPost", entityId: id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry.actorId).toBe(editor.userId);
    expect(entry.before).toMatchObject({ scheduledFor: first.toISOString(), accountId });
    expect(entry.after).toMatchObject({ scheduledFor: moved.toISOString(), accountId, contentChanged: false });
  });

  it("records credentials renewed, by the system, with the new expiry and never a token", async () => {
    await db.socialAccount.update({
      where: { id: accountId },
      data: { refreshToken: encryptSecret("li-refresh-token"), tokenExpiresAt: new Date(Date.now() + 60_000) },
    });
    const since = new Date();
    await usableCredentials(accountId, linkedin);

    const entry = await db.auditLog.findFirstOrThrow({
      where: { entityType: "SocialAccount", entityId: accountId, action: "UPDATE", createdAt: { gte: since } },
    });
    expect(entry.actorId).toBeNull();
    expect(entry.after).toMatchObject({ credentialsRenewed: true, permissionsReported: ["email", "openid", "profile", "w_member_social"] });
    expect((entry.after as { tokenExpiresAt: string }).tokenExpiresAt).toMatch(/^20\d\d-/);
    const row = JSON.stringify(entry);
    for (const secret of ["li-access-token", "li-refresh-token", "li-secret"]) expect(row).not.toContain(secret);
  });

  it("records the change to needs-reconnecting once, even when two paths notice together", async () => {
    await Promise.all([
      recordSyncResult(accountId, { ok: false, error: "LinkedIn rejected the credentials.", credentialsRejected: true }),
      recordSyncResult(accountId, { ok: false, error: "LinkedIn rejected the credentials.", credentialsRejected: true }),
    ]);
    const entries = await db.auditLog.findMany({ where: { entityType: "SocialAccount", entityId: accountId, action: "STATUS_CHANGE" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.actorId).toBeNull();
    expect(entries[0]!.before).toEqual({ status: "CONNECTED" });
    expect(entries[0]!.after).toEqual({ status: "NEEDS_RECONNECT", reason: "LinkedIn rejected the credentials." });
  });
});
