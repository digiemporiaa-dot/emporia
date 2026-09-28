/**
 * The key that stops a post going out twice.
 *
 * ## What actually prevents double publishing
 *
 * Two things, and it is worth being clear about which does the work.
 *
 * The **claim** is the real mutex: `UPDATE ... WHERE id = ? AND status =
 * 'SCHEDULED'` flips the post to `PUBLISHING`, and the database guarantees
 * exactly one caller sees a row affected. Two schedulers firing at the same
 * instant, a cron that overlaps its own previous run, a human hitting Publish
 * while the scheduler is mid-flight — all of them resolve there, because they
 * are all contending for one row in one transaction.
 *
 * The **idempotency key** is the second belt. Every attempt writes a
 * `SocialPublication` whose key is derived, not random, so a replayed or
 * duplicated attempt collides on a unique index instead of producing a second
 * row that claims a second post went out.
 *
 * Deriving the key rather than generating one is the whole point: a random key
 * would make every retry unique, which is exactly the property you do not want
 * from an idempotency key.
 */

/**
 * `post:<id>:<attempt>`.
 *
 * The attempt number is part of it because a genuine retry after a failure
 * *should* be allowed to write a new row — a failed publication and its later
 * successful retry are two real events and the history is worth keeping. What
 * must not happen is two rows for the *same* attempt, and that is what the
 * unique index refuses.
 */
export function publicationKey(postId: string, attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`attempt must be a positive integer, got ${attempt}`);
  }
  return `post:${postId}:${attempt}`;
}

/** How many times a post is retried automatically before it waits for a person. */
export const MAX_ATTEMPTS = 3;
