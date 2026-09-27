import type { SocialPostStatus, SocialPostType, SocialProvider } from "@/generated/prisma/enums";
import type { SocialCapabilities } from "@/lib/social/types";

/**
 * What each provider can actually do.
 *
 * One table, declared from the platforms' published API capabilities, rather
 * than `provider === "INSTAGRAM"` branches spread through the editor and the
 * publisher. When a platform changes what its API allows, this file changes
 * and nothing else does.
 *
 * Deliberately conservative: a capability is listed only where the platform's
 * **content publishing API** supports it, not where the platform's own app
 * does. Instagram Stories and X are the cases that catch people out — both are
 * things you can obviously do by hand and cannot reliably do through the API
 * on a standard tier — so the UI says a format is unsupported rather than
 * queueing something that will fail at 7:30pm.
 */
export const CAPABILITIES: Record<SocialProvider, SocialCapabilities> = {
  INSTAGRAM: {
    postTypes: ["SINGLE_IMAGE", "CAROUSEL", "REEL", "VIDEO"],
    // No `linkUrl`: a link in an Instagram caption is not clickable, so
    // offering the field would invite an editor to waste it.
    fields: ["caption", "hashtags", "mentions", "firstComment"],
    captionLimit: 2_200,
    carouselLimit: 10,
    metrics: true,
    nativeScheduling: false,
  },
  FACEBOOK: {
    postTypes: ["SINGLE_IMAGE", "CAROUSEL", "VIDEO", "REEL", "TEXT", "LINK"],
    fields: ["caption", "hashtags", "mentions", "callToAction", "linkUrl"],
    captionLimit: 63_206,
    carouselLimit: 10,
    metrics: true,
    nativeScheduling: true,
  },
  LINKEDIN: {
    postTypes: ["SINGLE_IMAGE", "CAROUSEL", "VIDEO", "TEXT", "LINK"],
    fields: ["caption", "hashtags", "mentions", "callToAction", "linkUrl", "firstComment"],
    captionLimit: 3_000,
    carouselLimit: 20,
    metrics: true,
    nativeScheduling: false,
  },
  YOUTUBE: {
    postTypes: ["YOUTUBE_VIDEO", "YOUTUBE_SHORT"],
    // A YouTube upload is titled, not captioned; the description is the body.
    fields: ["headline", "caption", "hashtags"],
    captionLimit: 5_000,
    carouselLimit: null,
    metrics: true,
    nativeScheduling: true,
  },
  X: {
    postTypes: ["TEXT", "SINGLE_IMAGE", "VIDEO"],
    fields: ["caption", "hashtags", "mentions", "linkUrl"],
    captionLimit: 280,
    carouselLimit: null,
    metrics: false,
    nativeScheduling: false,
  },
  GOOGLE_BUSINESS_PROFILE: {
    postTypes: ["GBP_POST"],
    fields: ["caption", "callToAction", "linkUrl"],
    captionLimit: 1_500,
    carouselLimit: null,
    metrics: true,
    nativeScheduling: false,
  },
};

export const PROVIDER_LABEL: Record<SocialProvider, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  X: "X",
  GOOGLE_BUSINESS_PROFILE: "Google Business Profile",
};

/**
 * Formats that are nothing without a creative.
 *
 * A property of the format, not of the platform: a reel is a video wherever it
 * is posted, and a text post needs no picture anywhere. Used to stop an empty
 * carousel being sent to a client for sign-off.
 */
export const TYPES_REQUIRING_MEDIA: ReadonlySet<SocialPostType> = new Set<SocialPostType>([
  "SINGLE_IMAGE",
  "CAROUSEL",
  "VIDEO",
  "REEL",
  "STORY",
  "YOUTUBE_VIDEO",
  "YOUTUBE_SHORT",
]);

/**
 * Two-letter platform codes, for a month cell where a full name would push the
 * time and the title out of view. These are the abbreviations social teams
 * already use, so they need no legend.
 */
export const PROVIDER_SHORT: Record<SocialProvider, string> = {
  INSTAGRAM: "IG",
  FACEBOOK: "FB",
  LINKEDIN: "LI",
  YOUTUBE: "YT",
  X: "X",
  GOOGLE_BUSINESS_PROFILE: "GBP",
};

export const POST_TYPE_LABEL: Record<SocialPostType, string> = {
  SINGLE_IMAGE: "Single image",
  CAROUSEL: "Carousel",
  VIDEO: "Video",
  REEL: "Reel",
  STORY: "Story",
  TEXT: "Text",
  LINK: "Link",
  YOUTUBE_VIDEO: "YouTube video",
  YOUTUBE_SHORT: "YouTube Short",
  GBP_POST: "Business Profile post",
};

export const POST_STATUS_LABEL: Record<SocialPostStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  PUBLISHING: "Publishing",
  PUBLISHED: "Published",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const POST_STATUS_TONE: Record<
  SocialPostStatus,
  "neutral" | "navy" | "warning" | "success" | "red"
> = {
  DRAFT: "neutral",
  SCHEDULED: "navy",
  PUBLISHING: "warning",
  PUBLISHED: "success",
  FAILED: "red",
  CANCELLED: "neutral",
};

export function supportsType(
  provider: SocialProvider,
  type: string,
): boolean {
  return (CAPABILITIES[provider].postTypes as readonly string[]).includes(type);
}

export function supportsField(provider: SocialProvider, field: string): boolean {
  return (CAPABILITIES[provider].fields as readonly string[]).includes(field);
}
