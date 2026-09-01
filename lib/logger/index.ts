import "server-only";
import pino from "pino";
import { env } from "@/lib/config/env";

/**
 * Structured JSON logging. No transports: the container writes to stdout and
 * the platform collects it.
 *
 * `redact` is not decoration — it is the guard that keeps passwords, tokens and
 * integration secrets out of logs (CLAUDE.md 11).
 */

const REDACTED = [
  "password",
  "passwordHash",
  "*.password",
  "*.passwordHash",
  "req.headers.authorization",
  "req.headers.cookie",
  "authorization",
  "cookie",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "apiKey",
  "*.apiKey",
  "gatewaySignature",
  "*.gatewaySignature",
];

function build(): pino.Logger {
  let level = "info";
  try {
    level = env().LOG_LEVEL;
  } catch {
    // Env not yet validated (e.g. during build). Fall back to a sane default
    // rather than making logging itself the thing that crashes.
  }
  return pino({
    level,
    redact: { paths: REDACTED, censor: "[redacted]" },
    base: { service: "emporia" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

let instance: pino.Logger | null = null;

export function logger(): pino.Logger {
  instance ??= build();
  return instance;
}

/** Child logger tagged with a subsystem, e.g. `log("auth").info(...)`. */
export function log(module: string): pino.Logger {
  return logger().child({ module });
}
