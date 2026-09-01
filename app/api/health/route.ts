import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";

/**
 * Liveness and readiness probe for Compose and Coolify
 * (docs/ARCHITECTURE.md 17.3).
 *
 * Deliberately returns no detail on failure — a health endpoint is
 * unauthenticated, and an error message here would leak infrastructure shape.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    log("health").error({ err: error }, "health check failed");
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
