import { decideInternalReview, submitForInternalReview } from "@/lib/services/social-review.service";
import type { Actor } from "@/lib/actor/types";

/**
 * Internal review is mandatory before anything goes to the client. Tests about
 * the client side run the real round first — submit, then approve — as a
 * separate reviewer, so what they exercise is the path a person takes.
 *
 * Errors are swallowed on purpose: a test that expects the send to be refused
 * (an empty version, the wrong stage) must see `requestSocialApproval`'s own
 * refusal, not this helper's.
 */
export function reviewerFor(userId: string): Actor {
  return {
    userId,
    name: "Reviewer",
    email: "reviewer@emporia.test",
    type: "STAFF",
    roleName: "MARKETING_MANAGER",
    roleId: null,
    clientId: null,
    permissions: new Set(["social.view", "social.edit", "social.review"]),
    ip: null,
    userAgent: "vitest",
  };
}

export async function approveInternally(contentItemId: string, userId: string): Promise<void> {
  const reviewer = reviewerFor(userId);
  try {
    await submitForInternalReview(reviewer, { contentItemId, note: null });
    await decideInternalReview(reviewer, { contentItemId, decision: "APPROVED", feedback: null });
  } catch {
    // See above.
  }
}
