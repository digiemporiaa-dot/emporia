import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { addDays, toDbDate } from "@/lib/seo-intel/dates";
import {
  createTaskFromOpportunity,
  detectDueOpportunities,
  detectOpportunities,
  dismissOpportunity,
  listOpportunities,
  markOpportunityDone,
  opportunitiesByWebsite,
  reopenOpportunity,
} from "@/lib/services/seo-intel/opportunity.service";
import { saveThresholds, thresholdSettings, thresholdsFor } from "@/lib/services/seo-intel/thresholds.service";
import type { Actor } from "@/lib/actor/types";

/**
 * The opportunity engine against the database: detection from stored Search
 * Console data and a crawl, reconciliation over repeated runs, dismissal,
 * task creation into the right client's project, and per-website thresholds.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;
const TAG = `op${Date.now().toString(36)}`;
const HOST = `${TAG}.example.com`;
const U = (path: string) => `https://${HOST}${path}`;
const LATEST = "2026-09-30";

describeDb("SEO opportunities", () => {
  let staffId = "";
  let clientA = "";
  let clientB = "";
  let propertyId = "";
  let projectA = "";
  let projectB = "";
  let runId = "";
  let pageId = "";

  const actor = (permissions: string[], overrides: Partial<Actor> = {}): Actor =>
    ({ userId: staffId, name: "Staff", email: "s@x.test", type: "STAFF", roleName: "ADMIN", roleId: "r", clientId: null, ip: null, userAgent: null, permissions: new Set(permissions), ...overrides }) as Actor;
  const manager = () => actor(["seo.intelligence.view", "seo.intelligence.manage", "seo.opportunities.manage", "tasks.create", "tasks.assign", "projects.view.team"]);
  const viewer = () => actor(["seo.intelligence.view"]);
  const mine = (where: object = {}) => db.seoOpportunity.findMany({ where: { propertyId, ...where }, orderBy: { fingerprint: "asc" } });

  beforeAll(async () => {
    staffId = (await db.user.findFirstOrThrow({ where: { type: "STAFF", status: "ACTIVE" }, select: { id: true } })).id;
    [clientA, clientB] = (await Promise.all(["a", "b"].map((x) => db.client.create({ data: { name: `Opp ${x} ${TAG}`, slug: `opp-${x}-${TAG}`, ownerId: staffId }, select: { id: true } })))).map((c) => c.id) as [string, string];
    propertyId = (await db.seoProperty.create({ data: { clientId: clientA, domain: HOST, displayName: "Opp site", crawlFrequency: "MANUAL", lastDetectedAt: new Date("2026-01-01") }, select: { id: true } })).id;
    projectA = (await db.project.create({ data: { code: `OPA-${TAG}`, name: "SEO retainer", clientId: clientA, managerId: staffId, startsAt: new Date("2026-01-01") }, select: { id: true } })).id;
    projectB = (await db.project.create({ data: { code: `OPB-${TAG}`, name: "Other client", clientId: clientB, managerId: staffId, startsAt: new Date("2026-01-01") }, select: { id: true } })).id;

    const totals = [];
    const pages = [];
    for (let i = 0; i < 84; i++) {
      const date = toDbDate(addDays(LATEST, -i));
      const block = i < 28 ? 2 : i < 56 ? 1 : 0;
      // Site clicks down 40% in the last 28 days: a high "What changed" drop.
      totals.push({ propertyId, date, clicks: block === 2 ? 30 : 50, impressions: 1000, position: 8 });
      pages.push({ propertyId, date, page: U("/blog/a"), clicks: [6, 4, 2][block]!, impressions: 100, position: 5 });
    }
    await db.gscDailyTotal.createMany({ data: totals });
    await db.gscPageDaily.createMany({ data: pages });

    const run = await db.crawlRun.create({
      data: { propertyId, trigger: "MANUAL", status: "SUCCEEDED", startUrl: U("/"), maxPages: 500, finishedAt: new Date(), pages: { create: { url: U("/gone"), depth: 1, source: "LINK", state: "FETCHED", statusCode: 404 } } },
      select: { id: true, pages: { select: { id: true } } },
    });
    runId = run.id;
    pageId = run.pages[0]!.id;
    await db.crawlIssue.createMany({
      data: [
        { runId, pageId, rule: "http-4xx", severity: "CRITICAL" },
        { runId, pageId, rule: "http-4xx", severity: "CRITICAL" },
        { runId, pageId, rule: "thin-content", severity: "NOTICE" },
      ],
    });
  });

  afterAll(async () => {
    if (!clientA) return;
    await db.seoOpportunity.deleteMany({ where: { propertyId } });
    await db.projectTask.deleteMany({ where: { projectId: { in: [projectA, projectB] } } });
    await db.project.deleteMany({ where: { id: { in: [projectA, projectB] } } });
    await db.seoProperty.deleteMany({ where: { clientId: { in: [clientA, clientB] } } });
    await db.seoThreshold.deleteMany({ where: { propertyId: null, key: "decay.minDrop", value: 0.11 } });
    await db.client.deleteMany({ where: { id: { in: [clientA, clientB] } } });
  });

  it("detects from every source that has data, and records what changed", async () => {
    const result = await detectOpportunities(propertyId, new Date("2026-10-01T06:00:00Z"));
    expect(result.sources.sort()).toEqual(["CHANGES", "CONTENT", "KEYWORDS", "TECHNICAL"]);
    const rows = await mine();
    const prints = rows.map((row) => row.fingerprint);
    expect(prints).toContain(`content:decaying:${U("/blog/a")}`);
    expect(prints).toContain("technical:http-4xx");
    expect(prints).toContain("changes:total-clicks");
    expect(prints).not.toContain("technical:thin-content");
    const technical = rows.find((row) => row.fingerprint === "technical:http-4xx")!;
    expect(technical).toMatchObject({ status: "OPEN", impact: 2, impactUnit: "pages", severity: "HIGH" });
    expect(await db.seoChangeEvent.count({ where: { propertyId, key: "total-clicks" } })).toBe(1);
    expect((await db.seoProperty.findUniqueOrThrow({ where: { id: propertyId } })).lastDetectedAt?.toISOString()).toBe("2026-10-01T06:00:00.000Z");
  });

  it("does not duplicate on the next run", async () => {
    const before = (await mine()).length;
    await detectOpportunities(propertyId);
    expect((await mine()).length).toBe(before);
    expect(await db.seoChangeEvent.count({ where: { propertyId, key: "total-clicks" } })).toBe(1);
  });

  it("lists agency-wide, worst first, for staff only", async () => {
    await expect(listOpportunities(actor(["seo.intelligence.view"], { type: "CLIENT", clientId: clientA }))).rejects.toThrow(ForbiddenError);
    const all = await listOpportunities(viewer(), { propertyId }, { perPage: 100 });
    expect(all.list.rows[0]?.severity).toBe("HIGH");
    expect(all.bySource.TECHNICAL).toBe(1);
    const technical = await listOpportunities(viewer(), { propertyId, source: "TECHNICAL" });
    expect(technical.list.rows.map((row) => row.type)).toEqual(["technical:http-4xx"]);
    const sites = await opportunitiesByWebsite(viewer());
    expect(sites.find((site) => site.id === propertyId)?.counts.HIGH).toBeGreaterThanOrEqual(2);
  });

  it("keeps a dismissal until the impact doubles", async () => {
    const technical = (await mine({ fingerprint: "technical:http-4xx" }))[0]!;
    await expect(dismissOpportunity(viewer(), technical.id, "known")).rejects.toThrow(ForbiddenError);
    await dismissOpportunity(manager(), technical.id, "Old URLs, redirect planned");
    await detectOpportunities(propertyId);
    expect((await db.seoOpportunity.findUniqueOrThrow({ where: { id: technical.id } })).status).toBe("DISMISSED");

    await db.crawlIssue.createMany({ data: [{ runId, pageId, rule: "http-4xx", severity: "CRITICAL" }, { runId, pageId, rule: "http-4xx", severity: "CRITICAL" }] });
    await detectOpportunities(propertyId);
    const reopened = await db.seoOpportunity.findUniqueOrThrow({ where: { id: technical.id } });
    expect(reopened).toMatchObject({ status: "OPEN", impact: 4, dismissReason: null });
  });

  it("creates a task in the website's client's project, once", async () => {
    const decay = (await mine({ type: "decaying" }))[0]!;
    await expect(createTaskFromOpportunity(manager(), decay.id, { projectId: projectB })).rejects.toThrow(/this website's client/);
    await expect(createTaskFromOpportunity(viewer(), decay.id, { projectId: projectA })).rejects.toThrow(ForbiddenError);
    const task = await createTaskFromOpportunity(manager(), decay.id, { projectId: projectA, assigneeId: staffId, dueAt: new Date("2026-10-15") });
    const stored = await db.projectTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(stored).toMatchObject({ projectId: projectA, status: "TODO", priority: "HIGH", assigneeId: staffId });
    expect(stored.title).toBe("Decaying page: /blog/a");
    expect(stored.description).toContain(U("/blog/a"));
    expect(await db.seoOpportunity.findUniqueOrThrow({ where: { id: decay.id } })).toMatchObject({ status: "TASK_CREATED", projectTaskId: task.id, assigneeId: staffId });
    await expect(createTaskFromOpportunity(manager(), decay.id, { projectId: projectA })).rejects.toThrow(ValidationError);
  });

  it("resolves what a source that ran no longer finds, keeping the task", async () => {
    await db.crawlIssue.deleteMany({ where: { runId, rule: "http-4xx" } });
    await detectOpportunities(propertyId);
    expect((await mine({ fingerprint: "technical:http-4xx" }))[0]).toMatchObject({ status: "RESOLVED" });
    // Content still found it; its task link stays.
    expect((await mine({ type: "decaying" }))[0]).toMatchObject({ status: "TASK_CREATED" });
  });

  it("does not resolve anything from a source that could not run", async () => {
    await db.crawlRun.update({ where: { id: runId }, data: { status: "FAILED" } });
    await db.seoOpportunity.updateMany({ where: { propertyId, fingerprint: "technical:http-4xx" }, data: { status: "OPEN", resolvedAt: null } });
    const result = await detectOpportunities(propertyId);
    expect(result.sources).not.toContain("TECHNICAL");
    expect((await mine({ fingerprint: "technical:http-4xx" }))[0]?.status).toBe("OPEN");
    await db.crawlRun.update({ where: { id: runId }, data: { status: "SUCCEEDED" } });
  });

  it("marks done and reopens", async () => {
    const changes = (await mine({ source: "CHANGES" }))[0]!;
    await markOpportunityDone(manager(), changes.id);
    expect((await db.seoOpportunity.findUniqueOrThrow({ where: { id: changes.id } })).status).toBe("DONE");
    await reopenOpportunity(manager(), changes.id);
    expect((await db.seoOpportunity.findUniqueOrThrow({ where: { id: changes.id } })).status).toBe("OPEN");
    await expect(reopenOpportunity(manager(), changes.id)).rejects.toThrow(ValidationError);
  });

  it("applies per-website thresholds over agency defaults", async () => {
    await expect(saveThresholds(manager(), null, { "decay.minDrop": 0.11 })).rejects.toThrow(ForbiddenError);
    await saveThresholds(actor(["seo.intelligence.connect"]), null, { "decay.minDrop": 0.11 });
    await expect(saveThresholds(manager(), propertyId, { "decay.minClicks": 0 })).rejects.toThrow(ValidationError);
    await expect(saveThresholds(manager(), propertyId, { "made.up": 3 })).rejects.toThrow(ValidationError);
    await saveThresholds(manager(), propertyId, { "decay.minClicks": 500 });

    const t = await thresholdsFor(propertyId);
    expect(t["decay.minClicks"]).toBe(500);
    expect(t["decay.minDrop"]).toBe(0.11);
    const settings = await thresholdSettings(viewer(), propertyId);
    expect(settings.overrides).toEqual({ "decay.minClicks": 500 });

    await detectOpportunities(propertyId);
    expect((await mine({ type: "decaying" }))[0]?.status).toBe("RESOLVED");

    await saveThresholds(manager(), propertyId, { "decay.minClicks": null });
    await detectOpportunities(propertyId);
    expect((await mine({ type: "decaying" }))[0]?.status).toBe("OPEN");
    await saveThresholds(actor(["seo.intelligence.connect"]), null, { "decay.minDrop": null });
  });

  it("runs daily from the schedule", async () => {
    await db.seoProperty.update({ where: { id: propertyId }, data: { lastDetectedAt: new Date(Date.now() - 2 * 86_400_000) } });
    await detectDueOpportunities({ limit: 500 });
    const after = await db.seoProperty.findUniqueOrThrow({ where: { id: propertyId } });
    expect(Date.now() - after.lastDetectedAt!.getTime()).toBeLessThan(60_000);
    const stamp = after.lastDetectedAt!.getTime();
    await detectDueOpportunities({ limit: 500 });
    expect((await db.seoProperty.findUniqueOrThrow({ where: { id: propertyId } })).lastDetectedAt!.getTime()).toBe(stamp);
  });
});
