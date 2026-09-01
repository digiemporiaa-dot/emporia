/**
 * Runs once when the server starts.
 *
 * Env is validated here rather than at module load so `next build` — which has
 * no database or secrets — still succeeds, while a misconfigured container dies
 * immediately at boot with a readable list of what is missing
 * (docs/ARCHITECTURE.md 17.5).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertEnv } = await import("@/lib/config/env");
  const { log } = await import("@/lib/logger");

  try {
    assertEnv();
    log("boot").info("environment validated");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    throw error;
  }
}
