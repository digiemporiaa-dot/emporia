import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  analyzeCRM,
  generateProposal,
  generateSEOContent,
  scoreLead,
  summarizeLead,
} from "@/lib/services/ai.service";
import { ai, isAIConfigured } from "@/lib/ai";
import { AIError } from "@/lib/ai/errors";
import { resetEnvCache } from "@/lib/config/env";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { startAnthropicDouble, type AnthropicDouble } from "./support/anthropic-double";
import type { Actor } from "@/lib/actor/types";

/**
 * The phase 16 rules: output is a draft, labelled as generated, and never
 * permitted to invent business metrics.
 *
 * The double below speaks the real Messages API wire shape, so the provider in
 * lib/ai/anthropic.ts runs for real through the official SDK — these assertions
 * are about the request we actually send and the reply we actually parse.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describeDb("ai assists", () => {
  let prisma: PrismaClient;
  let double: AnthropicDouble;
  let actor: Actor;
  let noAiActor: Actor;

  const tag = `ai-${Date.now()}`;
  let leadId = "";
  let sourceId = "";
  let serviceId = "";
  let cityId = "";
  let proposalId = "";

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    double = await startAnthropicDouble();

    process.env["AI_PROVIDER"] = "anthropic";
    process.env["AI_API_KEY"] = "test-key";
    process.env["AI_BASE_URL"] = double.url;
    resetEnvCache();

    const staff = await prisma.user.findFirstOrThrow({
      where: { type: "STAFF" },
      select: { id: true },
    });

    const base = {
      userId: staff.id,
      name: "Assistant User",
      email: "ai@emporia.test",
      type: "STAFF" as const,
      roleName: "ADMIN" as const,
      roleId: "r",
      clientId: null,
      ip: null,
      userAgent: null,
    };

    actor = {
      ...base,
      permissions: new Set([
        "ai.use",
        "leads.view",
        "leads.view.team",
        "proposals.edit",
        "seo.edit",
        "content.create",
        "analytics.view",
        "invoices.view",
      ]),
    };
    noAiActor = { ...base, permissions: new Set(["leads.view", "leads.view.team"]) };

    const source = await prisma.leadSource.create({
      data: { name: `${tag} source`, slug: `${tag}-source`, type: "WEBSITE_FORM" },
      select: { id: true },
    });
    sourceId = source.id;

    const [service, city] = await Promise.all([
      prisma.service.create({
        data: { slug: `${tag}-svc`, name: "Paid search", shortDescription: "Google Ads management" },
        select: { id: true },
      }),
      prisma.city.create({
        data: { slug: `${tag}-city`, name: "Nagpur", state: "Maharashtra", population: 2400000 },
        select: { id: true },
      }),
    ]);
    serviceId = service.id;
    cityId = city.id;

    const lead = await prisma.lead.create({
      data: {
        name: "Priya Raman",
        company: "Ironleaf Foods",
        email: "priya@ironleaf.test",
        message: "We want to grow direct orders. Currently spending nothing on ads.",
        budget: "450000.00",
        currency: "INR",
        score: 62,
        status: "QUALIFIED",
        sourceId,
        serviceId,
        cityId,
      },
      select: { id: true },
    });
    leadId = lead.id;

    const proposal = await prisma.proposal.create({
      data: {
        number: `PRO-AI-${Date.now()}`,
        title: "Paid search launch",
        status: "DRAFT",
        currency: "INR",
        leadId,
        createdById: staff.id,
        subtotal: "300000.00",
        discountTotal: "0.00",
        taxTotal: "54000.00",
        total: "354000.00",
        items: {
          create: {
            name: "Google Ads management",
            description: "Six months, three campaigns",
            quantity: "6",
            unitPrice: "50000.00",
            discountRate: "0",
            taxRate: "18",
            lineTotal: "354000.00",
            order: 0,
          },
        },
      },
      select: { id: true },
    });
    proposalId = proposal.id;
  });

  afterEach(() => {
    double.requests.length = 0;
  });

  afterAll(async () => {
    await double.close();
    await prisma.auditLog.deleteMany({ where: { entityType: "AIDraft" } });
    await prisma.proposalItem.deleteMany({ where: { proposalId } });
    await prisma.proposal.deleteMany({ where: { id: proposalId } });
    await prisma.lead.deleteMany({ where: { sourceId } });
    await prisma.leadSource.deleteMany({ where: { id: sourceId } });
    await prisma.service.deleteMany({ where: { id: serviceId } });
    await prisma.city.deleteMany({ where: { id: cityId } });
    await prisma.$disconnect();

    for (const key of ["AI_PROVIDER", "AI_API_KEY", "AI_BASE_URL"]) delete process.env[key];
    resetEnvCache();
  });

  // ── The provider itself ─────────────────────────────────────────────────

  it("sends the model, the effort and the key the way the real API expects", async () => {
    double.reply({ summary: "Wants to grow direct orders.", nextStep: "Call Priya.", questions: [] });
    await summarizeLead(actor, leadId);

    const sent = double.requests[0];
    expect(sent?.model).toBe("claude-opus-5");
    expect(sent?.authorization).toBe("test-key");
    // Summaries are cheap work; the analysis task raises this.
    expect(sent?.effort).toBe("low");
    expect(sent?.format).toMatchObject({ type: "json_schema" });
  });

  it("asks for a higher effort when the task is analysis", async () => {
    await prisma.lead.update({ where: { id: leadId }, data: { status: "QUALIFIED" } });
    double.reply("Two thirds of leads come from one source.");
    await analyzeCRM(actor, { range: "ytd" });

    expect(double.requests[0]?.effort).toBe("high");
  });

  // ── Never invents business metrics ──────────────────────────────────────

  it("hands the model the real figures rather than letting it supply them", async () => {
    double.reply({ summary: "s", nextStep: "n", questions: [] });
    await summarizeLead(actor, leadId);

    const prompt = double.requests[0]?.prompt ?? "";
    // The stated budget is passed through exactly as stored.
    expect(prompt).toContain("INR 450000.00");
    expect(prompt).toContain("computed score: 62");
    expect(prompt).toContain("Ironleaf Foods");
    // And the instruction that forbids inventing another one.
    expect(double.requests[0]?.system).toContain("Never estimate");
  });

  it("does not send prices to the proposal drafter", async () => {
    double.reply("An opening paragraph.");
    await generateProposal(actor, { proposalId, brief: null });

    const prompt = double.requests[0]?.prompt ?? "";
    // The line names go; the money does not, so a drafted paragraph cannot
    // contradict the priced total on the same page.
    expect(prompt).toContain("Google Ads management");
    expect(prompt).not.toContain("354000");
    expect(prompt).not.toContain("50000");
    expect(double.requests[0]?.system).toContain("never write the pricing");
  });

  it("withholds revenue from the analysis when the actor cannot see finance", async () => {
    const marketer: Actor = {
      ...actor,
      permissions: new Set(["ai.use", "analytics.view", "leads.view", "leads.view.team"]),
    };

    double.reply("Commentary.");
    const result = await analyzeCRM(marketer, { range: "ytd" });

    const keys = result.data.facts.map(([key]) => key);
    expect(keys).not.toContain("revenue received");
    expect(keys).not.toContain("outstanding");
    expect(double.requests[0]?.prompt).toContain("not been given revenue figures");
  });

  it("returns the figures alongside the prose so the page renders our own numbers", async () => {
    double.reply("Some commentary that might misquote a number.");
    const result = await analyzeCRM(actor, { range: "ytd" });

    const facts = Object.fromEntries(result.data.facts);
    expect(facts["period"]).toBe("This year");
    expect(Number(facts["leads"])).toBeGreaterThan(0);
  });

  it("refuses to analyse a period with no leads rather than inventing insight", async () => {
    // Move the fixture out of the last week so the window is genuinely empty.
    const created = (await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).createdAt;
    await prisma.lead.update({
      where: { id: leadId },
      data: { createdAt: new Date(Date.now() - 60 * 86400000) },
    });

    await expect(analyzeCRM(actor, { range: "7d" })).rejects.toBeInstanceOf(ValidationError);
    // Nothing was even asked of the model.
    expect(double.requests).toHaveLength(0);

    await prisma.lead.update({ where: { id: leadId }, data: { createdAt: created } });
  });

  // ── Always a draft, always marked ───────────────────────────────────────

  it("marks every result as generated and names the model", async () => {
    double.reply({ summary: "s", nextStep: "n", questions: [] });
    const summary = await summarizeLead(actor, leadId);

    expect(summary.generated).toBe(true);
    expect(summary.model).toBe("claude-opus-5");
    expect(summary.task).toBe("summarizeLead");
  });

  it("writes nothing to the record it was asked about", async () => {
    const before = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

    double.reply({
      confidence: "HIGH",
      reasoning: "Clear budget and a specific goal.",
      strengths: ["stated budget"],
      concerns: [],
      missing: ["phone number"],
    });
    await scoreLead(actor, leadId);

    const after = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    // The rules engine's score is untouched, and so is everything else.
    expect(after.score).toBe(before.score);
    expect(after.status).toBe(before.status);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it("audits the call without a user having saved anything", async () => {
    double.reply({ summary: "s", nextStep: "n", questions: [] });
    await summarizeLead(actor, leadId);

    const row = await prisma.auditLog.findFirst({
      where: { entityType: "AIDraft" },
      orderBy: { createdAt: "desc" },
    });

    const payload = row?.after as { task: string; model: string; outputTokens: number };
    expect(payload.task).toBe("summarizeLead");
    expect(payload.model).toBe("claude-opus-5");
    expect(payload.outputTokens).toBe(45);
  });

  // ── SEO drafts and the thin-page rule ───────────────────────────────────

  it("carries the model's own verdict on whether it had enough local detail", async () => {
    double.reply({
      metaTitle: "Paid search in Nagpur",
      metaDescription: "Google Ads management for Nagpur businesses.",
      intro: "Nagpur's wholesale and logistics trade...",
      enoughLocalDetail: false,
      note: "I know little specific about Nagpur's market.",
    });

    const draft = await generateSEOContent(actor, { serviceId, cityId, notes: null });

    // Surfaced rather than swallowed: a page without genuine local content is
    // what canPublish() refuses, and the draft must not hide that.
    expect(draft.data.enoughLocalDetail).toBe(false);
    expect(draft.data.note).toContain("Nagpur");
    expect(double.requests[0]?.system).toContain("Generic copy with the");
  });

  it("refuses a reply that does not match the shape it asked for", async () => {
    double.reply({ metaTitle: "Only a title" });

    await expect(
      generateSEOContent(actor, { serviceId, cityId, notes: null }),
    ).rejects.toThrow();
  });

  it("refuses a reply that is not JSON at all", async () => {
    double.reply("Sorry, here is some prose instead of the object you wanted.");

    // A reply that is not the shape asked for is an AI failure with its own
    // reason, so a caller can tell it from a rejected key.
    await expect(summarizeLead(actor, leadId)).rejects.toMatchObject({
      reason: "AI_INVALID_RESPONSE",
    });
  });

  // ── Authorization ───────────────────────────────────────────────────────

  it("refuses every assist without ai.use", async () => {
    await expect(summarizeLead(noAiActor, leadId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(scoreLead(noAiActor, leadId)).rejects.toBeInstanceOf(ForbiddenError);
    expect(double.requests).toHaveLength(0);
  });

  it("will not summarise a lead the actor may not read", async () => {
    const rep: Actor = {
      ...actor,
      userId: "someone-else",
      permissions: new Set(["ai.use", "leads.view"]),
    };

    // Visible only to its assignee, and this lead is assigned to nobody.
    await expect(summarizeLead(rep, leadId)).rejects.toThrow();
    expect(double.requests).toHaveLength(0);
  });

  // ── Unconfigured ────────────────────────────────────────────────────────

  it("throws a typed error, and offers nothing, when no provider is configured", async () => {
    delete process.env["AI_PROVIDER"];
    delete process.env["AI_API_KEY"];
    resetEnvCache();

    expect(await isAIConfigured()).toBe(false);
    // The typed AI failure, not a generic integration error: callers branch on
    // `reason` to tell "no key" from "key rejected".
    await expect(summarizeLead(actor, leadId)).rejects.toBeInstanceOf(AIError);

    process.env["AI_PROVIDER"] = "anthropic";
    process.env["AI_API_KEY"] = "test-key";
    resetEnvCache();
  });

  it("treats an unknown provider as unconfigured rather than guessing", async () => {
    process.env["AI_PROVIDER"] = "some-other-vendor";
    resetEnvCache();

    expect(await isAIConfigured()).toBe(false);
    expect((await ai()).describe).toContain("No AI provider");

    process.env["AI_PROVIDER"] = "anthropic";
    resetEnvCache();
  });

  it("surfaces an API failure rather than a fabricated answer", async () => {
    double.failWith(429, JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }));

    await expect(summarizeLead(actor, leadId)).rejects.toThrow();
  });
});
