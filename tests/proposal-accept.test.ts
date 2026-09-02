import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  acceptProposal,
  contractFromProposal,
  createProposal,
  getProposal,
  reviseProposal,
  sendProposal,
  setProposalStatus,
  updateProposal,
} from "@/lib/services/sales.service";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/actor/types";

/**
 * The Phase 8 exit criterion: accepting a proposal creates a Client.
 *
 * Driven through the service layer against a real database, so the transaction
 * boundary and the foreign keys are exercised rather than mocked.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

describeDb("proposal acceptance", () => {
  let prisma: PrismaClient;
  let actor: Actor;
  let weakActor: Actor;
  let leadId = "";
  const created: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: connectionString as string }),
    });

    const user = await prisma.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    const base = {
      userId: user.id,
      name: "Test",
      email: "t@t.test",
      type: "STAFF" as const,
      roleName: "SALES_MANAGER" as const,
      roleId: "r",
      clientId: null,
      ip: null,
      userAgent: null,
    };
    actor = {
      ...base,
      permissions: new Set([
        "proposals.view",
        "proposals.create",
        "proposals.edit",
        "proposals.send",
        "clients.create",
        "clients.view",
        "contracts.create",
        "contracts.edit",
        "contracts.view",
      ]),
    };
    // Can edit proposals but may not create clients — acceptance must refuse.
    weakActor = { ...base, permissions: new Set(["proposals.view", "proposals.edit"]) };
  });

  afterAll(async () => {
    await prisma.contract.deleteMany({ where: { title: { startsWith: "Accept test" } } });
    await prisma.proposalItem.deleteMany({ where: { proposal: { title: { startsWith: "Accept test" } } } });
    await prisma.proposalRevision.deleteMany({ where: { proposal: { title: { startsWith: "Accept test" } } } });
    await prisma.proposal.deleteMany({ where: { title: { startsWith: "Accept test" } } });
    await prisma.clientContact.deleteMany({ where: { client: { name: { startsWith: "Accept" } } } });
    await prisma.client.deleteMany({ where: { name: { startsWith: "Accept" } } });
    await prisma.leadActivity.deleteMany({ where: { lead: { email: { endsWith: "@accept.test" } } } });
    await prisma.lead.deleteMany({ where: { email: { endsWith: "@accept.test" } } });
    await prisma.$disconnect();
  });

  async function makeLead(name: string, company: string | null) {
    const source = await prisma.leadSource.findFirstOrThrow({
      where: { slug: "website-form" },
      select: { id: true },
    });
    const lead = await prisma.lead.create({
      data: {
        name,
        company,
        email: `${name.toLowerCase().replace(/\s+/g, "")}@accept.test`,
        phone: "+91 90000 00000",
        sourceId: source.id,
        status: "PROPOSAL",
      },
      select: { id: true },
    });
    return lead.id;
  }

  async function makeProposal(title: string, forLeadId: string) {
    const proposal = await createProposal(actor, {
      title,
      currency: "INR",
      leadId: forLeadId,
      items: [
        {
          name: "Growth retainer",
          quantity: "1",
          unitPrice: "125000.00",
          discountRate: "10",
          taxRate: "18",
        },
      ],
    });
    created.push(proposal.id);
    return proposal.id;
  }

  it("creates a numbered draft with stored totals", async () => {
    leadId = await makeLead("Accept One", "Accept One Pvt Ltd");
    const id = await makeProposal("Accept test one", leadId);

    const proposal = await getProposal(actor, id);
    expect(proposal.number).toMatch(/^PRO-\d{4}-\d{4}$/);
    expect(proposal.status).toBe("DRAFT");
    // 125000 less 10% = 112500, plus 18% = 132750
    expect(proposal.total).toBe("132750");
    expect(proposal.items[0]?.lineTotal).toBe("132750");
  });

  it("refuses to send an empty proposal", async () => {
    const empty = await prisma.proposal.create({
      data: {
        number: `PRO-TEST-${Date.now()}`,
        title: "Accept test empty",
        status: "DRAFT",
        currency: "INR",
        createdById: actor.userId,
        leadId,
      },
      select: { id: true },
    });
    await expect(sendProposal(actor, empty.id)).rejects.toThrow(ValidationError);
  });

  it("snapshots a revision on send", async () => {
    const id = await makeProposal("Accept test revision", await makeLead("Accept Two", "Accept Two Ltd"));
    await sendProposal(actor, id);

    const revisions = await prisma.proposalRevision.findMany({
      where: { proposalId: id },
      select: { version: true, snapshot: true },
    });
    expect(revisions).toHaveLength(1);
    const snap = revisions[0]?.snapshot as { total: string; items: unknown[] };
    expect(snap.total).toBe("132750");
    expect(snap.items).toHaveLength(1);
  });

  it("refuses to edit the priced lines once sent", async () => {
    const id = await makeProposal("Accept test locked", await makeLead("Accept Three", null));
    await sendProposal(actor, id);

    await expect(
      updateProposal(actor, id, {
        title: "Accept test locked",
        currency: "INR",
        items: [{ name: "Cheaper", quantity: "1", unitPrice: "1.00", discountRate: "0", taxRate: "0" }],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("allows revision, which bumps the version and re-opens editing", async () => {
    const id = await makeProposal("Accept test revise", await makeLead("Accept Four", null));
    await sendProposal(actor, id);
    await reviseProposal(actor, id);

    const proposal = await getProposal(actor, id);
    expect(proposal.status).toBe("DRAFT");
    expect(proposal.version).toBe(2);

    await updateProposal(actor, id, {
      title: "Accept test revise",
      currency: "INR",
      items: [{ name: "Revised", quantity: "1", unitPrice: "100000.00", discountRate: "0", taxRate: "18" }],
    });

    const revised = await getProposal(actor, id);
    expect(revised.total).toBe("118000");

    // Sending again snapshots the new version alongside the old one.
    await sendProposal(actor, id);
    const revisions = await prisma.proposalRevision.findMany({ where: { proposalId: id } });
    expect(revisions.map((r) => r.version).sort()).toEqual([1, 2]);
  });

  it("THE CRITERION: accepting creates a Client and wins the lead", async () => {
    const thisLead = await makeLead("Accept Five", "Accept Five Industries");
    const id = await makeProposal("Accept test criterion", thisLead);
    await sendProposal(actor, id);
    await setProposalStatus(actor, id, "VIEWED");

    const result = await acceptProposal(actor, id);

    expect(result.clientCreated).toBe(true);
    expect(result.leadId).toBe(thisLead);

    const client = await prisma.client.findUniqueOrThrow({
      where: { id: result.clientId },
      select: { name: true, slug: true, status: true, contacts: true },
    });
    // The company name is preferred over the contact's personal name.
    expect(client.name).toBe("Accept Five Industries");
    expect(client.slug).toBe("accept-five-industries");
    expect(client.status).toBe("ACTIVE");

    // The lead's contact carries forward as the primary contact.
    expect(client.contacts).toHaveLength(1);
    expect(client.contacts[0]?.isPrimary).toBe(true);
    expect(client.contacts[0]?.name).toBe("Accept Five");

    // Lead → Client conversion on WON, as a real foreign key.
    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: thisLead },
      select: { status: true, convertedClientId: true, convertedAt: true },
    });
    expect(lead.status).toBe("WON");
    expect(lead.convertedClientId).toBe(result.clientId);
    expect(lead.convertedAt).not.toBeNull();

    // And the proposal is linked to the client it produced.
    const proposal = await prisma.proposal.findUniqueOrThrow({
      where: { id },
      select: { status: true, clientId: true, decidedAt: true },
    });
    expect(proposal.status).toBe("ACCEPTED");
    expect(proposal.clientId).toBe(result.clientId);
    expect(proposal.decidedAt).not.toBeNull();
  });

  it("records the conversion on the lead timeline", async () => {
    const activities = await prisma.leadActivity.findMany({
      where: { lead: { email: "acceptfive@accept.test" } },
      select: { type: true, summary: true },
    });
    const types = activities.map((a) => a.type);
    expect(types).toContain("PROPOSAL_SENT");
    expect(types).toContain("CONVERTED");
    expect(types).toContain("STATUS_CHANGED");
  });

  it("falls back to the contact name when the lead has no company", async () => {
    const thisLead = await makeLead("Accept Six", null);
    const id = await makeProposal("Accept test noco", thisLead);
    await sendProposal(actor, id);
    const result = await acceptProposal(actor, id);

    const client = await prisma.client.findUniqueOrThrow({
      where: { id: result.clientId },
      select: { name: true },
    });
    expect(client.name).toBe("Accept Six");
  });

  it("requires clients.create to accept, not merely proposals.edit", async () => {
    const id = await makeProposal("Accept test perms", await makeLead("Accept Seven", null));
    await sendProposal(actor, id);
    await expect(acceptProposal(weakActor, id)).rejects.toThrow(ForbiddenError);

    // And the proposal is untouched by the refusal.
    const proposal = await prisma.proposal.findUniqueOrThrow({ where: { id }, select: { status: true } });
    expect(proposal.status).toBe("SENT");
  });

  it("refuses to accept twice", async () => {
    const id = await makeProposal("Accept test twice", await makeLead("Accept Eight", null));
    await sendProposal(actor, id);
    await acceptProposal(actor, id);
    await expect(acceptProposal(actor, id)).rejects.toThrow(ValidationError);
  });

  it("refuses to accept a draft that was never sent", async () => {
    const id = await makeProposal("Accept test unsent", await makeLead("Accept Nine", null));
    await expect(acceptProposal(actor, id)).rejects.toThrow(ValidationError);
  });

  it("drafts a contract from the accepted proposal, carrying the value across", async () => {
    const thisLead = await makeLead("Accept Ten", "Accept Ten Co");
    const id = await makeProposal("Accept test contract", thisLead);
    await sendProposal(actor, id);
    await acceptProposal(actor, id);

    const contract = await contractFromProposal(actor, id, new Date("2026-07-01"));
    expect(contract.number).toMatch(/^CON-\d{4}-\d{4}$/);
    expect(contract.value.toString()).toBe("132750");
    expect(contract.status).toBe("DRAFT");

    // One contract per proposal.
    await expect(contractFromProposal(actor, id, new Date("2026-07-01"))).rejects.toThrow(ConflictError);
  });

  it("will not draft a contract from a proposal that is not accepted", async () => {
    const id = await makeProposal("Accept test nocontract", await makeLead("Accept Eleven", null));
    await sendProposal(actor, id);
    await expect(contractFromProposal(actor, id, new Date())).rejects.toThrow(ValidationError);
  });
});
