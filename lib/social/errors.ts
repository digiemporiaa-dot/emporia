import { AppError } from "@/lib/errors";

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
