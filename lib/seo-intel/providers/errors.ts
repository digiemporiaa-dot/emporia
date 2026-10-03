import { AppError } from "@/lib/errors";

/**
 * What a provider call can fail with, typed so the sync engine acts on the
 * kind of failure instead of parsing messages.
 *
 * Every message is safe to show: it says what to do, never echoes a token or
 * a raw provider body.
 */

/** The credentials are no longer accepted (revoked, expired grant, deleted key). A person must reconnect. */
export class SeoCredentialsError extends AppError {
  constructor(message: string) {
    super("FORBIDDEN", 401, message);
  }
}

/** Signed in fine, but this account cannot read that site or property. */
export class SeoAccessError extends AppError {
  constructor(message: string) {
    super("FORBIDDEN", 403, message);
  }
}

/** Google's quota; try again later. */
export class SeoRateLimitError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = "Google asked us to slow down. The next sync will continue.") {
    super("RATE_LIMITED", 429, message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Anything else from the provider: unreachable, 5xx, an answer we cannot read. Retryable. */
export class SeoProviderError extends AppError {
  constructor(message: string) {
    super("INTERNAL", 502, message);
  }
}
