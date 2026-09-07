/**
 * Typed application errors.
 *
 * Every error carries a code and a message that is safe to show a user. Raw
 * stack traces never reach the UI (CLAUDE.md 11) — the error boundary renders
 * `publicMessage` and the logger records the rest.
 */

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTEGRATION_NOT_CONFIGURED"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly publicMessage: string;
  readonly details?: unknown;

  constructor(
    code: AppErrorCode,
    status: number,
    publicMessage: string,
    options?: { cause?: unknown; details?: unknown; internalMessage?: string },
  ) {
    super(options?.internalMessage ?? publicMessage, { cause: options?.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
    this.details = options?.details;
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "You must be signed in to do that.") {
    super("UNAUTHENTICATED", 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.", details?: unknown) {
    super("FORBIDDEN", 403, message, { details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.") {
    super("NOT_FOUND", 404, message);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Some of the details you entered are not valid.", details?: unknown) {
    super("VALIDATION", 422, message, { details });
  }
}

export class ConflictError extends AppError {
  // `details` matches ForbiddenError and ValidationError, so a conflict that
  // knows which field it is about (a duplicate slug, say) can say so and have
  // the form render the message against that input rather than only in a banner.
  constructor(message = "That conflicts with something that already exists.", details?: unknown) {
    super("CONFLICT", 409, message, { details });
  }
}

export class RateLimitedError extends AppError {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = "Too many attempts. Please try again shortly.") {
    super("RATE_LIMITED", 429, message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Raised when an integration is called without credentials. The operation fails
 * visibly instead of pretending to succeed (CLAUDE.md 2 rule 5).
 */
export class IntegrationNotConfiguredError extends AppError {
  readonly provider: string;
  constructor(provider: string) {
    super(
      "INTEGRATION_NOT_CONFIGURED",
      503,
      `${provider} is not configured yet. Add its credentials to enable this feature.`,
      { internalMessage: `Integration "${provider}" called without configuration.` },
    );
    this.provider = provider;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Shape safe to return from a server action to the client. */
export type ActionFailure = {
  ok: false;
  code: AppErrorCode;
  message: string;
  details?: unknown;
};

export type ActionSuccess<T> = { ok: true; data: T };
export type ActionResult<T> = ActionSuccess<T> | ActionFailure;

export function toActionFailure(error: unknown): ActionFailure {
  if (isAppError(error)) {
    return {
      ok: false,
      code: error.code,
      message: error.publicMessage,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return {
    ok: false,
    code: "INTERNAL",
    message: "Something went wrong. Please try again.",
  };
}
