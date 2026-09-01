import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/config/env";

/**
 * Prisma client singleton.
 *
 * Prisma 7 compiles queries in-process and connects through a driver adapter,
 * so there is no Rust engine binary and no `binaryTargets` to match against the
 * container's OpenSSL (docs/ARCHITECTURE.md 17.1).
 *
 * The export is a lazy Proxy rather than an eagerly constructed client. Next
 * imports every route module during `next build` to collect metadata, and an
 * eager client would read DATABASE_URL at that moment — forcing the container
 * build to have database credentials and breaking the hermetic build this
 * project deliberately chose (docs/ARCHITECTURE.md 17.2). Nothing connects
 * until the first query.
 *
 * The global cache prevents dev-server hot reloads from opening a new pool on
 * every recompile.
 */

declare global {
  var __emporiaPrisma: PrismaClient | undefined;
}

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });
  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? [{ emit: "stdout", level: "warn" }, { emit: "stdout", level: "error" }]
        : [{ emit: "stdout", level: "error" }],
  });
}

let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (globalThis.__emporiaPrisma) return globalThis.__emporiaPrisma;
  client ??= createClient();
  if (process.env.NODE_ENV !== "production") globalThis.__emporiaPrisma = client;
  return client;
}

export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const instance = getClient();
    const value = Reflect.get(instance, property, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
  has(_target, property) {
    return property in getClient();
  },
});

/** Transaction client type, for services that take an optional tx. */
export type DbClient = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
