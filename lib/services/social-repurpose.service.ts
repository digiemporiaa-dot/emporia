import "server-only";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/rbac";
import { resolveClientScope } from "@/lib/social/scope";
import { PROVIDER_LABEL } from "@/lib/social/capabilities";
import { createSocialContent } from "@/lib/services/social-content.service";
import { savePost } from "@/lib/services/social-post.service";
import { socialPostSchema } from "@/lib/validation/social";
import type { SocialProvider } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/actor/types";

/**
 * Turn a reviewed repurpose draft into content: one idea, with a version per
 * platform, each marked as an AI draft.
 *
 * The versions arrive from the browser — the person has just read them in the
 * repurpose dialog, and may have edited them there — so they are validated
 * exactly as hand-typed copy is, against each platform's rules, before
 * anything is written. The AI mark is set here, on the server, and cleared by
 * `savePost` the first time a person saves the version; until then the
 * version cannot be sent to the client.
 *
 * Built from the existing services rather than beside them: the idea is made
 * by `createSocialContent`, which proves the project, campaign and pillar are
 * this client's; each version by `savePost`, which applies the platform's
 * rules and the audit trail.
 */

export type RepurposedVersionInput = {
  provider: SocialProvider;
  type: string;
  caption: string;
  headline: string | null;
  hashtags: string[];
  linkUrl: string | null;
};

export async function createRepurposedContent(
  actor: Actor,
  input: {
    clientId: string;
    projectId: string;
    campaignId: string | null;
    pillarId: string | null;
    title: string;
    brief: string | null;
    sourceBlogPostId: string | null;
    versions: RepurposedVersionInput[];
  },
): Promise<{ id: string }> {
  requirePermission(actor, "social.create");
  const scope = await resolveClientScope(actor, input.clientId);

  if (input.versions.length === 0) throw new ValidationError("There are no versions to create.");
  if (new Set(input.versions.map((v) => v.provider)).size !== input.versions.length) {
    throw new ValidationError("Each platform can have one version here.");
  }

  // Every version checked before anything is written, so a bad one cannot
  // leave half an idea behind.
  const parsed = input.versions.map((version) => {
    const result = socialPostSchema.safeParse({
      contentItemId: "pending",
      provider: version.provider,
      type: version.type,
      caption: version.caption,
      headline: version.headline,
      hashtags: version.hashtags,
      linkUrl: version.linkUrl,
    });
    if (!result.success) {
      throw new ValidationError(
        `The ${PROVIDER_LABEL[version.provider]} version: ${result.error.issues[0]?.message ?? "check it"}`,
      );
    }
    return result.data;
  });

  if (input.sourceBlogPostId) {
    const post = await db.blogPost.findFirst({
      where: { id: input.sourceBlogPostId, status: "PUBLISHED" },
      select: { id: true },
    });
    if (!post) throw new ValidationError("That article is not published.");
  }

  const item = await createSocialContent(actor, {
    clientId: scope,
    projectId: input.projectId,
    title: input.title,
    brief: input.brief,
    campaignId: input.campaignId,
    pillarId: input.pillarId,
    ownerId: null,
    scheduledFor: null,
  });

  try {
    if (input.sourceBlogPostId) {
      await db.contentCalendarItem.update({
        where: { id: item.id },
        data: { sourceBlogPostId: input.sourceBlogPostId },
      });
    }
    const created: string[] = [];
    for (const version of parsed) {
      const post = await savePost(actor, null, { ...version, contentItemId: item.id });
      created.push(post.id);
    }
    await db.socialPost.updateMany({ where: { id: { in: created } }, data: { aiDraftedAt: new Date() } });
  } catch (error) {
    // The versions were checked above, so this is rare — but an idea with
    // some of its versions missing is worse than no idea. Its versions go
    // with it (cascade).
    await db.contentCalendarItem.delete({ where: { id: item.id } }).catch(() => undefined);
    throw error;
  }

  return item;
}
