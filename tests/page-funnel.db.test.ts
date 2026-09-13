import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { pageFunnel } from "@/lib/services/analytics.service";
import { resolveRange } from "@/lib/analytics/range";
import type { Actor } from "@/lib/actor/types";

/**
 * What each page is worth.
 *
 * The claim this report makes is that the revenue column sums to money the
 * agency actually received. That only holds if a client who arrived through two
 * pages is counted under one of them, so most of what follows is about
 * attribution being once-and-only-once — and about traffic being absent rather
 * than zero.
 */

const connectionString = process.env["TEST_DATABASE_URL"];
const describeDb = connectionString ? describe : describe.skip;

const SUFFIX = `pf-${Date.now()}`;
const RANGE = resolveRange("all");

function actorWith(userId: string, permissions: string[]): Actor {
  return {
    userId,
    name: "Analyst",
    email: null,
    type: "STAFF",
    roleName: "ADMIN",
    roleId: null,
    clientId: null,
    permissions: new Set(permissions),
    ip: null,
    userAgent: "vitest",
  };
}

describeDb("page funnel", () => {
  const leads: string[] = [];
  const clients: string[] = [];
  const invoices: string[] = [];
  const payments: string[] = [];
  const pages: string[] = [];
  let analyst: Actor;
  let sourceId: string;

  beforeAll(async () => {
    const staff = await db.user.findFirstOrThrow({ where: { type: "STAFF" }, select: { id: true } });
    analyst = actorWith(staff.id, [
      "analytics.view",
      "invoices.view",
      "leads.view",
      // Reporting on the whole site needs the whole team's leads; without this
      // `visibilityFilter` narrows to the actor's own, which the last test here
      // relies on.
      "leads.view.team",
    ]);
    const source = await db.leadSource.findFirstOrThrow({ select: { id: true } });
    sourceId = source.id;
  });

  afterAll(async () => {
    await db.payment.deleteMany({ where: { id: { in: payments } } });
    await db.invoice.deleteMany({ where: { id: { in: invoices } } });
    await db.lead.deleteMany({ where: { id: { in: leads } } });
    await db.client.deleteMany({ where: { id: { in: clients } } });
    await db.page.deleteMany({ where: { id: { in: pages } } });
  });

  async function newClient(name: string) {
    const client = await db.client.create({
      data: {
        name: `${name} ${SUFFIX}`,
        slug: `${name.toLowerCase()}-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
      },
      select: { id: true },
    });
    clients.push(client.id);
    return client.id;
  }

  async function newLead(over: {
    landingPath?: string | null;
    status?: string;
    clientId?: string;
    convertedAt?: Date;
  }) {
    const lead = await db.lead.create({
      data: {
        name: `Lead ${SUFFIX}`,
        email: `${Math.random().toString(36).slice(2, 10)}@example.test`,
        sourceId,
        landingPath: over.landingPath ?? null,
        status: (over.status ?? "NEW") as never,
        ...(over.clientId
          ? { convertedClientId: over.clientId, convertedAt: over.convertedAt ?? new Date() }
          : {}),
      },
      select: { id: true },
    });
    leads.push(lead.id);
    return lead.id;
  }

  /** A captured payment of `amount` for a client. */
  async function paid(clientId: string, amount: string) {
    const invoice = await db.invoice.create({
      data: {
        clientId,
        number: `INV-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
        status: "PAID",
        dueAt: new Date(),
        total: amount,
        paidTotal: amount,
      },
      select: { id: true },
    });
    invoices.push(invoice.id);

    const payment = await db.payment.create({
      data: {
        invoiceId: invoice.id,
        clientId,
        amount,
        status: "CAPTURED",
        idempotencyKey: `${SUFFIX}-${Math.random().toString(36).slice(2, 12)}`,
        receivedAt: new Date(),
      },
      select: { id: true },
    });
    payments.push(payment.id);
  }

  const rowFor = async (path: string) =>
    (await pageFunnel(analyst, RANGE)).find((row) => row.path === path);

  // -------------------------------------------------------------------------
  // Counting
  // -------------------------------------------------------------------------

  it("counts leads against the page they landed on", async () => {
    const path = `/${SUFFIX}-counted`;
    await newLead({ landingPath: path });
    await newLead({ landingPath: path });

    expect((await rowFor(path))?.leads).toBe(2);
  });

  it("counts a qualified lead as qualified, and a new one as not", async () => {
    const path = `/${SUFFIX}-qualified`;
    await newLead({ landingPath: path, status: "NEW" });
    await newLead({ landingPath: path, status: "QUALIFIED" });
    await newLead({ landingPath: path, status: "WON" });

    const row = await rowFor(path);
    expect(row?.leads).toBe(3);
    // WON is past qualified, so it counts too — the column is "got somewhere".
    expect(row?.qualified).toBe(2);
  });

  it("gathers query strings and trailing slashes into one page", async () => {
    // Three rows for one page would understate every one of them.
    const path = `/${SUFFIX}-messy`;
    await newLead({ landingPath: path });
    await newLead({ landingPath: `${path}/` });
    await newLead({ landingPath: `${path}?utm_source=x` });

    expect((await rowFor(path))?.leads).toBe(3);
  });

  it("gathers leads with no landing path under one honest label", async () => {
    await newLead({ landingPath: null });
    const row = (await pageFunnel(analyst, RANGE)).find((r) => r.path === "Unknown");
    expect(row?.leads).toBeGreaterThanOrEqual(1);
  });

  it("names and links a path that is a CMS page", async () => {
    const page = await db.page.create({
      data: { slug: `${SUFFIX}-real`, title: "A real page", status: "PUBLISHED" },
      select: { id: true, slug: true },
    });
    pages.push(page.id);
    await newLead({ landingPath: `/${page.slug}` });

    const row = await rowFor(`/${page.slug}`);
    expect(row?.title).toBe("A real page");
    expect(row?.pageId).toBe(page.id);
  });

  it("leaves a path with no matching page unnamed rather than inventing one", async () => {
    const path = `/${SUFFIX}-elsewhere`;
    await newLead({ landingPath: path });

    const row = await rowFor(path);
    expect(row?.title).toBeNull();
    expect(row?.pageId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Revenue, attributed once
  // -------------------------------------------------------------------------

  it("attributes a client's revenue to the page that brought them", async () => {
    const path = `/${SUFFIX}-earner`;
    const client = await newClient("Earner");
    await newLead({ landingPath: path, status: "WON", clientId: client });
    await paid(client, "5000.00");

    const row = await rowFor(path);
    expect(row?.clients).toBe(1);
    expect(row?.revenue).toBe("5000.00");
  });

  it("counts a client who arrived twice only once, under the first page", async () => {
    // The whole credibility of the column rests on this: adding the payments
    // under both pages would make it sum to more than the agency received.
    const first = `/${SUFFIX}-first`;
    const second = `/${SUFFIX}-second`;
    const client = await newClient("Twice");

    const earlier = new Date(Date.now() - 60 * 60 * 1000);
    await newLead({ landingPath: first, status: "WON", clientId: client, convertedAt: earlier });
    await newLead({ landingPath: second, status: "WON", clientId: client, convertedAt: new Date() });
    await paid(client, "9000.00");

    expect((await rowFor(first))?.revenue).toBe("9000.00");
    expect((await rowFor(second))?.revenue).toBe("0.00");
    expect((await rowFor(second))?.clients).toBe(0);
  });

  it("reports a page with leads but no money as zero revenue, not as missing", async () => {
    const path = `/${SUFFIX}-dry`;
    await newLead({ landingPath: path });

    // Zero revenue is a fact here: the leads exist and none of them paid.
    expect((await rowFor(path))?.revenue).toBe("0.00");
  });

  // -------------------------------------------------------------------------
  // Traffic, and permissions
  // -------------------------------------------------------------------------

  it("reports sessions as absent rather than zero", async () => {
    const path = `/${SUFFIX}-traffic`;
    await newLead({ landingPath: path });

    // Nothing stores a pageview. A zero would claim the page has no visitors.
    expect((await rowFor(path))?.sessions).toBeNull();
  });

  it("withholds revenue from an actor without the finance permission", async () => {
    const path = `/${SUFFIX}-nomoney`;
    const client = await newClient("Hidden");
    await newLead({ landingPath: path, status: "WON", clientId: client });
    await paid(client, "7000.00");

    const noFinance = actorWith(analyst.userId, [
      "analytics.view",
      "leads.view",
      "leads.view.team",
    ]);
    const row = (await pageFunnel(noFinance, RANGE)).find((r) => r.path === path);
    // The service withholds it; the screen does not merely hide it.
    expect(row?.clients).toBe(1);
    expect(row?.revenue).toBe("0.00");
  });

  it("shows a sales executive only the pages their own leads landed on", async () => {
    // `visibilityFilter` narrows to the actor's own leads without
    // `leads.view.team`, and the report inherits that rather than working
    // around it.
    const path = `/${SUFFIX}-someone-elses`;
    await newLead({ landingPath: path });

    const ownOnly = actorWith(analyst.userId, ["analytics.view", "leads.view"]);
    const rows = await pageFunnel(ownOnly, RANGE);
    expect(rows.find((r) => r.path === path)).toBeUndefined();
  });

  it("needs analytics.view", async () => {
    const outsider = actorWith(analyst.userId, []);
    await expect(pageFunnel(outsider, RANGE)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sorts the biggest earner first", async () => {
    const small = `/${SUFFIX}-small`;
    const big = `/${SUFFIX}-big`;
    const a = await newClient("Small");
    const b = await newClient("Big");
    await newLead({ landingPath: small, status: "WON", clientId: a });
    await newLead({ landingPath: big, status: "WON", clientId: b });
    await paid(a, "100.00");
    await paid(b, "100000.00");

    const rows = await pageFunnel(analyst, RANGE);
    expect(rows.findIndex((r) => r.path === big)).toBeLessThan(
      rows.findIndex((r) => r.path === small),
    );
  });
});
