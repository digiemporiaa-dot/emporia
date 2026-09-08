import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { syncPlatform } from "./platform.js";

/**
 * `npm run db:sync` — bring the database in line with the deployed code.
 *
 * Run by the container entrypoint after `migrate deploy`, so a release that
 * adds a permission, an email template or a section type does not need anybody
 * to remember a command (docs/ARCHITECTURE.md 17.4). Safe to run by hand, and
 * safe to run repeatedly.
 *
 * It creates no users and writes no demo content: prisma/platform.ts is the
 * list of what it touches and what it refuses to overwrite.
 */

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is required to sync.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

await syncPlatform(prisma)
  .then(() => {
    console.log("Done.");
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
