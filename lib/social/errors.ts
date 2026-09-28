import { AppError, ValidationError } from "@/lib/errors";

/**
 * The provider may or may not have published.
 *
 * Distinct from an ordinary failure, and the distinction is the whole reason
 * this class exists: a failed publication is safe to retry, and an ambiguous
 * one is not. LinkedIn accepting a post and returning no id is the real case —
 * the post exists, we simply do not know its id, and a retry would put a second
 * copy on the client's feed.
 *
 * The engine treats this as terminal: the post is marked failed, no automatic
 * retry is scheduled, and the message tells a person to go and look before
 * doing anything. A human checking one feed is cheap; a duplicate post on a
 * client's LinkedIn is not.
 */
export class AmbiguousPublishError extends AppError {
  constructor(message: string) {
    super("CONFLICT", 409, message);
  }
}

/**
 * The platform could not be reached at all.
 *
 * On a read, or before anything has been created, this is an ordinary
 * retryable failure. On the one request that *creates* a post it is not —
 * the request may have landed and the answer been lost — so the adapter turns
 * it into an `AmbiguousPublishError` at exactly that call and nowhere else.
 */
export class ProviderUnreachableError extends ValidationError {}

/**
 * The platform rejected our credentials.
 *
 * Typed so the engine can act on it rather than parse a message: the account is
 * marked as needing reconnection, and the post is not retried automatically,
 * because retrying with a revoked token three times buys three failures and
 * nothing else.
 */
export class CredentialsRejectedError extends ValidationError {}
