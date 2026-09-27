import { z } from "zod";
import type { SocialProvider, SocialPostType } from "@/generated/prisma/enums";

/**
 * What the client was shown, frozen.
 *
 * ## Why a copy and not a join
 *
 * A creative approval was once a file and a note, and pointing at the live row
 * was fine. A social approval is several platform versions, each with its own
 * caption, hashtags and creative — and those rows stay editable. Point at them
 * and "the client approved this" degrades into "the client approved something
 * that used to be here", which is worth nothing the first time a caption is
 * tweaked after sign-off.
 *
 * So the versions are copied into the `ApprovalVersion` at the moment it is
 * sent. The copy is what the portal renders and what the audit trail means.
 *
 * ## Why this is not the only defence
 *
 * A snapshot makes the record honest; it does not stop the live post drifting
 * away from it. `social-post.service` handles that end: a version cannot be
 * edited while the client is looking at it, and editing one after sign-off
 * pulls the item back out of `APPROVED`.
 *
 * ## What is deliberately absent
 *
 * No account id, no token, no internal id beyond the post's own. The portal
 * renders this object directly, so anything in it is something the client can
 * read. The account is named, because it is the client's own account and they
 * should know which one a post goes to; nothing else about it travels.
 */

export const snapshotItemSchema = z.object({
  postId: z.string().min(1).max(40),
  provider: z.enum([
    "INSTAGRAM",
    "FACEBOOK",
    "LINKEDIN",
    "YOUTUBE",
    "X",
    "GOOGLE_BUSINESS_PROFILE",
  ]),
  type: z.enum([
    "SINGLE_IMAGE",
    "CAROUSEL",
    "VIDEO",
    "REEL",
    "STORY",
    "TEXT",
    "LINK",
    "YOUTUBE_VIDEO",
    "YOUTUBE_SHORT",
    "GBP_POST",
  ]),
  accountName: z.string().max(200).nullable(),
  caption: z.string().max(10000).nullable(),
  headline: z.string().max(500).nullable(),
  hashtags: z.array(z.string().max(100)).max(60),
  mentions: z.array(z.string().max(100)).max(60),
  callToAction: z.string().max(200).nullable(),
  firstComment: z.string().max(10000).nullable(),
  linkUrl: z.string().max(2000).nullable(),
  scheduledFor: z.string().nullable(),
  media: z
    .array(
      z.object({
        url: z.string().max(2000),
        type: z.string().max(40),
        alt: z.string().max(500).nullable(),
      }),
    )
    .max(20),
});

export const socialSnapshotSchema = z.object({
  kind: z.literal("social"),
  /** Bumped if the shape ever changes, so an old row stays readable. */
  version: z.literal(1),
  takenAt: z.string(),
  itemTitle: z.string().max(300),
  itemScheduledFor: z.string().nullable(),
  posts: z.array(snapshotItemSchema).min(1).max(30),
});

export type SocialSnapshot = z.infer<typeof socialSnapshotSchema>;
export type SocialSnapshotItem = z.infer<typeof snapshotItemSchema>;

/** The shape `buildSnapshot` needs, so the service can select exactly this. */
export type SnapshotSource = {
  id: string;
  provider: SocialProvider;
  type: SocialPostType;
  caption: string | null;
  headline: string | null;
  hashtags: string[];
  mentions: string[];
  callToAction: string | null;
  firstComment: string | null;
  linkUrl: string | null;
  scheduledFor: Date | null;
  account: { name: string } | null;
  media: { media: { url: string; type: string; alt: string | null } }[];
};

export function buildSnapshot(
  item: { title: string; scheduledFor: Date | null },
  posts: readonly SnapshotSource[],
  takenAt = new Date(),
): SocialSnapshot {
  return socialSnapshotSchema.parse({
    kind: "social",
    version: 1,
    takenAt: takenAt.toISOString(),
    itemTitle: item.title,
    itemScheduledFor: item.scheduledFor ? item.scheduledFor.toISOString() : null,
    posts: posts.map((post) => ({
      postId: post.id,
      provider: post.provider,
      type: post.type,
      accountName: post.account?.name ?? null,
      caption: post.caption,
      headline: post.headline,
      hashtags: post.hashtags,
      mentions: post.mentions,
      callToAction: post.callToAction,
      firstComment: post.firstComment,
      linkUrl: post.linkUrl,
      scheduledFor: post.scheduledFor ? post.scheduledFor.toISOString() : null,
      media: post.media.map((entry) => ({
        url: entry.media.url,
        type: entry.media.type,
        alt: entry.media.alt,
      })),
    })),
  });
}

/**
 * Read a stored snapshot back.
 *
 * Returns null rather than throwing for anything that is not a social
 * snapshot — the column is shared with ordinary creative approvals, which have
 * none, and an approval from before this phase will never have one. A screen
 * that cannot show the snapshot falls back to the notes it always showed.
 */
export function readSnapshot(value: unknown): SocialSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const parsed = socialSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
