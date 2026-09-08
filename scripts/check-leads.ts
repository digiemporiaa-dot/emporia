import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * Why the New Proposal dropdowns might be empty.
 *
 * Run against whichever database the app is pointed at:
 *
 *   DATABASE_URL=... npx tsx scripts/check-leads.ts
 *
 * It answers three questions in order — are there leads at all, does the
 * dropdown's own filter exclude them, and does the signed-in user's row-level
 * scoping exclude them — so the answer is never a guess.
 */

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

function redactHost(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "(unparseable)";
  }
}

async function main(): Promise<void> {
  console.log(`Database: ${redactHost(connectionString!)}\n`);

  const total = await db.lead.count();
  const live = await db.lead.count({ where: { deletedAt: null } });
  console.log(`Leads: ${total} total, ${live} not soft-deleted`);

  const byStatus = await db.lead.groupBy({
    by: ["status"],
    _count: { _all: true },
    where: { deletedAt: null },
  });
  if (byStatus.length === 0) {
    console.log("  (no rows to group)");
  } else {
    for (const row of byStatus) {
      console.log(`  ${row.status.padEnd(12)} ${row._count._all}`);
    }
  }

  // Exactly the filter the New Proposal page applies.
  const offered = await db.lead.count({
    where: { deletedAt: null, status: { notIn: ["WON", "LOST"] } },
  });
  console.log(`\nAfter the dropdown's own filter (not WON or LOST): ${offered}`);

  // Row-level scoping: a sales executive without `leads.view.team` only sees
  // leads assigned to them, so an unassigned lead is invisible to them.
  const unassigned = await db.lead.count({ where: { deletedAt: null, assignedToId: null } });
  console.log(`Unassigned leads: ${unassigned}`);

  const byAssignee = await db.lead.groupBy({
    by: ["assignedToId"],
    _count: { _all: true },
    where: { deletedAt: null },
  });
  for (const row of byAssignee) {
    const who = row.assignedToId
      ? ((await db.user.findUnique({ where: { id: row.assignedToId }, select: { email: true } }))
          ?.email ?? row.assignedToId)
      : "(unassigned)";
    console.log(`  ${who}: ${row._count._all}`);
  }

  const clients = await db.client.count({ where: { deletedAt: null } });
  console.log(`\nClients not soft-deleted: ${clients}`);

  const staff = await db.user.count({ where: { type: "STAFF" } });
  console.log(`Staff users: ${staff}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
