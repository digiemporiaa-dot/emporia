import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { submitForInternalReview, decideInternalReview } from "@/lib/services/social-review.service";
import { requestSocialApproval } from "@/lib/services/social-approval.service";
import { setPostStatus } from "@/lib/services/social-post.service";
import { collectMetrics } from "@/lib/services/social-metrics.service";
import { generateReport, setReportPublished } from "@/lib/services/social-report.service";
import {
  announceMetricsSynced,
  announceReportPublished,
  announceReviewDecided,
  announceReviewSubmitted,
  announceScheduled,
  announceSentToClient,
} from "@/lib/services/social-notify.service";
import { TRIGGER_FACTS, TRIGGER_LABEL, WIRED_TRIGGERS } from "@/lib/automation/types";
import { LinkedInProvider } from "@/lib/social/linkedin";
import { UnconfiguredSocialProvider } from "@/lib/social/unconfigured";
import { encryptSecret } from "@/lib/security/secret";
import { startLinkedInDouble, type LinkedInDouble } from "./support/linkedin-double";
import type { Actor } from "@/lib/actor/types";
import type { AutomationTriggerType } from "@/generated/prisma/enums";

/**
 * The workflow's messages (brief §34) and automation triggers (§35).
 *
 * Pinned: the people attached to the work hear about an internal submission,
 * never the person who made it; the submitter hears the reviewer's decision,
 * unless they reviewed it themselves; the client's active portal users — and
 * only this client's — are emailed when posts wait for them and when a monthly
 * report is published, never for a draft; and each workflow step fires its
 * trigger through the existing rules engine, the metrics one once per post per
 * day.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `wfn${Date.now()}`;

const NEW_TRIGGERS = [
  "SOCIAL_REVIEW_SUBMITTED",
  "SOCIAL_SENT_FOR_APPROVAL",
  "SOCIAL_POST_SCHEDULED",
  "SOCIAL_METRICS_SYNCED",
] as const;

describe("the workflow triggers in the automation vocabulary", () => {
  it("offers each with a label and the post's facts", () => {
    for (const trigger of NEW_TRIGGERS) {
      expect(WIRED_TRIGGERS).toContain(trigger);
      expect(TRIGGER_LABEL[trigger]).toBeTruthy();
      expect(TRIGGER_FACTS[trigger].map((f) => f.key)).toContain("client.name");
    }
    expect(TRIGGER_FACTS.SOCIAL_SENT_FOR_APPROVAL.map((f) => f.key)).toContain("social.approvalVersion");
  });
});

describeDb("social workflow notifications", () => {
  let double: LinkedInDouble;
  let linkedin: LinkedInProvider;
  let roleId = "";
  let clientId = "";
  let otherClientId = "";
  let projectId = "";
  let accountId = "";
  const users = { owner: "", manager: "", submitter: "", portal: "", suspended: "", otherPortal: "" };
  const emails = { portal: "", suspended: "", otherPortal: "" };
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
  const ALL = ["social.view", "social.edit", "social.review", "social.approve", "social.reports.view", "social.reports.manage"];
  const submitter = () => staff(users.submitter, ["social.view", "social.edit", "social.approve"]);
  const reviewer = () => staff(users.owner, ["social.view", "social.review"]);

  async function user(key: string, over: { type?: "STAFF" | "CLIENT"; clientId?: string; status?: "ACTIVE" | "SUSPENDED" } = {}) {
    const email = `${TAG}-${key}@emporia.test`;
    const created = await db.user.create({
      data: { email, name: key, type: over.type ?? "STAFF", status: over.status ?? "ACTIVE", roleId, clientId: over.clientId ?? null },
      select: { id: true },
    });
    return { id: created.id, email };
  }

  /** An idea with one ready LinkedIn version, at the given stage. */
  async function idea(stage: "DRAFT" | "APPROVED" = "DRAFT", status: "DRAFT" | "PUBLISHED" = "DRAFT") {
    counter += 1;
    const item = await db.contentCalendarItem.create({
      data: { clientId, projectId, ownerId: users.owner, title: `${TAG} idea ${counter}`, channel: "LINKEDIN", stage },
      select: { id: true },
    });
    const post = await db.socialPost.create({
      data: {
        contentItemId: item.id,
        clientId,
        accountId,
        provider: "LINKEDIN",
        type: "TEXT",
        status,
        caption: `A LinkedIn post, number ${counter}, for the notification tests.`,
        scheduledFor: new Date(Date.now() + 86_400_000),
        publishedAt: status === "PUBLISHED" ? new Date(Date.now() - 3_600_000) : null,
        externalPostId: status === "PUBLISHED" ? "urn:li:share:7000000000000000001" : null,
      },
      select: { id: true },
    });
    return { itemId: item.id, postId: post.id };
  }

  /** An active rule on one trigger, narrowed to this file's client, telling the manager. */
  async function rule(trigger: AutomationTriggerType, extra: { field: string; operator: string; value: unknown }[] = []) {
    const created = await db.automation.create({
      data: {
        name: `${TAG} ${trigger}`,
        isActive: true,
        triggers: { create: { type: trigger } },
        conditions: {
          create: [{ field: "client.name", operator: "eq", value: `${TAG} client`, order: 0 }, ...extra.map((c, i) => ({ ...c, value: c.value as never, order: i + 1 }))],
        },
        actions: { create: { type: "NOTIFY_USER", config: { to: "SPECIFIC", userId: users.manager, title: `${TAG} rule ${trigger} {{social.title}}` } } },
      },
      select: { id: true },
    });
    automationIds.push(created.id);
    return created.id;
  }

  const fired = (trigger: AutomationTriggerType) =>
    db.notification.count({ where: { userId: users.manager, title: { startsWith: `${TAG} rule ${trigger}` } } });
  const inbox = (userId: string, entityId: string) =>
    db.notification.findMany({ where: { userId, entityId }, select: { title: true, body: true, href: true } });
  const mail = (entityId: string) =>
    db.emailLog.findMany({ where: { entityId, templateKey: "CLIENT_NOTIFICATION" }, select: { to: true, variables: true } });

  beforeAll(async () => {
    double = await startLinkedInDouble();
    linkedin = new LinkedInProvider({
      clientId: "app-id",
      clientSecret: "app-secret",
      authBase: `${double.url}/oauth/v2`,
      apiBase: `${double.url}/v2`,
      restBase: `${double.url}/rest`,
    });

    roleId = (await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { roleId: true } })).roleId;
    clientId = (await db.client.create({ data: { name: `${TAG} client`, slug: `${TAG}-a` }, select: { id: true } })).id;
    otherClientId = (await db.client.create({ data: { name: `${TAG} other`, slug: `${TAG}-b` }, select: { id: true } })).id;

    users.owner = (await user("owner")).id;
    users.manager = (await user("manager")).id;
    users.submitter = (await user("submitter")).id;
    const portal = await user("portal", { type: "CLIENT", clientId });
    const suspended = await user("suspended", { type: "CLIENT", clientId, status: "SUSPENDED" });
    const otherPortal = await user("other-portal", { type: "CLIENT", clientId: otherClientId });
    Object.assign(users, { portal: portal.id, suspended: suspended.id, otherPortal: otherPortal.id });
    Object.assign(emails, { portal: portal.email, suspended: suspended.email, otherPortal: otherPortal.email });

    projectId = (
      await db.project.create({
        data: { code: `W-${TAG}`.slice(0, 20), name: "Retainer", clientId, managerId: users.manager, startsAt: new Date(), status: "ACTIVE" },
        select: { id: true },
      })
    ).id;
    accountId = (
      await db.socialAccount.create({
        data: { clientId, provider: "LINKEDIN", externalId: `${TAG}-member`, name: "On LinkedIn", status: "CONNECTED", accessToken: encryptSecret("li-access-token") },
        select: { id: true },
      })
    ).id;
  });

  afterEach(async () => {
    await db.automation.deleteMany({ where: { id: { in: automationIds.splice(0) } } });
  });

  afterAll(async () => {
    const userIds = Object.values(users).filter(Boolean);
    const clients = [clientId, otherClientId].filter(Boolean);
    await db.notification.deleteMany({ where: { userId: { in: userIds } } });
    await db.emailLog.deleteMany({ where: { to: { startsWith: TAG } } });
    await db.socialReport.deleteMany({ where: { clientId: { in: clients } } });
    await db.approval.deleteMany({ where: { clientId: { in: clients } } });
    await db.socialMetricSnapshot.deleteMany({ where: { clientId: { in: clients } } });
    await db.socialPost.deleteMany({ where: { clientId: { in: clients } } });
    await db.socialInternalReview.deleteMany({ where: { clientId: { in: clients } } });
    await db.contentCalendarItem.deleteMany({ where: { clientId: { in: clients } } });
    await db.socialAccount.deleteMany({ where: { clientId: { in: clients } } });
    await db.project.deleteMany({ where: { clientId: { in: clients } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.client.deleteMany({ where: { id: { in: clients } } });
    await double?.close();
  });

  it("tells the owner and the manager about an internal submission, never the submitter, and fires its trigger", async () => {
    await rule("SOCIAL_REVIEW_SUBMITTED");
    const { itemId } = await idea();
    await submitForInternalReview(submitter(), { contentItemId: itemId, note: null });

    for (const userId of [users.owner, users.manager]) {
      const [sent, ...rest] = await inbox(userId, itemId);
      expect(rest).toEqual([]);
      expect(sent).toMatchObject({ title: `Review pending: ${TAG} client`, href: `/admin/clients/${clientId}/social/content/${itemId}` });
      expect(sent!.body).toContain(`${TAG} idea`);
    }
    expect(await inbox(users.submitter, itemId)).toEqual([]);
    expect(await fired("SOCIAL_REVIEW_SUBMITTED")).toBe(1);
  });

  it("does not tell the owner about their own submission", async () => {
    const { itemId } = await idea();
    await submitForInternalReview(staff(users.owner, ["social.view", "social.edit"]), { contentItemId: itemId, note: null });
    expect(await inbox(users.owner, itemId)).toEqual([]);
    expect(await inbox(users.manager, itemId)).toHaveLength(1);
  });

  it("tells the submitter what the reviewer decided, with the feedback", async () => {
    const { itemId } = await idea();
    await submitForInternalReview(submitter(), { contentItemId: itemId, note: null });
    await decideInternalReview(reviewer(), { contentItemId: itemId, decision: "CHANGES_REQUESTED", feedback: "Shorter, please." });

    const [sent] = await inbox(users.submitter, itemId);
    expect(sent).toMatchObject({ title: `Changes requested: "${TAG} idea ${counter}"`, body: "Shorter, please." });

    await submitForInternalReview(submitter(), { contentItemId: itemId, note: null });
    await decideInternalReview(reviewer(), { contentItemId: itemId, decision: "APPROVED", feedback: null });
    expect((await inbox(users.submitter, itemId)).map((n) => n.title)).toContain(`Approved internally: "${TAG} idea ${counter}"`);
  });

  it("does not tell a reviewer about their own decision", async () => {
    const { itemId } = await idea();
    const self = staff(users.submitter, ALL);
    await submitForInternalReview(self, { contentItemId: itemId, note: null });
    await decideInternalReview(self, { contentItemId: itemId, decision: "APPROVED", feedback: null });
    expect(await inbox(users.submitter, itemId)).toEqual([]);
  });

  it("emails this client's active portal users when posts wait for them, and fires its trigger", async () => {
    await rule("SOCIAL_SENT_FOR_APPROVAL", [{ field: "social.approvalVersion", operator: "eq", value: 1 }]);
    const { itemId } = await idea();
    await submitForInternalReview(submitter(), { contentItemId: itemId, note: null });
    await decideInternalReview(reviewer(), { contentItemId: itemId, decision: "APPROVED", feedback: null });
    const { approvalId } = await requestSocialApproval(submitter(), { contentItemId: itemId, note: null });

    const sent = await mail(approvalId);
    // Not the suspended user, not the other client's.
    expect(sent.map((m) => m.to)).toEqual([emails.portal]);
    const variables = sent[0]!.variables as Record<string, string>;
    expect(variables["subject"]).toBe("1 post is waiting for your approval");
    expect(variables["actionUrl"]).toMatch(new RegExp(`/portal/approvals/${approvalId}$`));
    expect(await fired("SOCIAL_SENT_FOR_APPROVAL")).toBe(1);

    // A second round says it was updated after their feedback, and does not
    // match a rule for first versions.
    await announceSentToClient(itemId, approvalId, 2);
    const again = await mail(approvalId);
    expect(again).toHaveLength(2);
    expect(again.map((m) => (m.variables as Record<string, string>)["body"] ?? "").some((b) => b.includes("after your feedback"))).toBe(true);
    expect(await fired("SOCIAL_SENT_FOR_APPROVAL")).toBe(1);
  });

  it("fires the scheduled trigger when a post is scheduled", async () => {
    await rule("SOCIAL_POST_SCHEDULED");
    const { postId } = await idea("APPROVED");
    await setPostStatus(staff(users.manager, ALL), postId, "SCHEDULED");
    expect(await fired("SOCIAL_POST_SCHEDULED")).toBe(1);
    // Taking it back off the schedule is not scheduling it.
    await setPostStatus(staff(users.manager, ALL), postId, "DRAFT");
    expect(await fired("SOCIAL_POST_SCHEDULED")).toBe(1);
  });

  it("fires the metrics trigger once per post per day, however often the collector runs", async () => {
    await rule("SOCIAL_METRICS_SYNCED");
    await idea("APPROVED", "PUBLISHED");
    const resolve = async (which: string) => (which === "LINKEDIN" ? linkedin : new UnconfiguredSocialProvider(which as never));
    await collectMetrics(new Date(), resolve);
    expect(await fired("SOCIAL_METRICS_SYNCED")).toBe(1);
    await collectMetrics(new Date(), resolve);
    expect(await fired("SOCIAL_METRICS_SYNCED")).toBe(1);
  });

  it("emails the client when a monthly report is published, and not while it is a draft", async () => {
    const manager = staff(users.manager, ALL);
    const { id } = await generateReport(manager, { clientId, month: "2026-08" }, new Date("2026-09-15T06:00:00Z"));
    expect(await mail(id)).toEqual([]);
    await announceReportPublished(id);
    expect(await mail(id)).toEqual([]);

    await setReportPublished(manager, id, true);
    const sent = await mail(id);
    expect(sent.map((m) => m.to)).toEqual([emails.portal]);
    const variables = sent[0]!.variables as Record<string, string>;
    expect(variables["subject"]).toBe("Your August 2026 social media report");
    expect(variables["actionUrl"]).toMatch(new RegExp(`/portal/social/reports/${id}$`));
  });

  it("never throws, whatever it is handed", async () => {
    await expect(announceReviewSubmitted("does-not-exist", users.owner)).resolves.toBeUndefined();
    await expect(announceReviewDecided("does-not-exist", users.owner, users.manager, "APPROVED", null)).resolves.toBeUndefined();
    await expect(announceSentToClient("does-not-exist", "nope", 1)).resolves.toBeUndefined();
    await expect(announceScheduled("does-not-exist", null)).resolves.toBeUndefined();
    await expect(announceMetricsSynced("does-not-exist")).resolves.toBeUndefined();
    await expect(announceReportPublished("does-not-exist")).resolves.toBeUndefined();
  });
});
