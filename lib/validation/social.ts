import { z } from "zod";
import { CAPABILITIES } from "@/lib/social/capabilities";
import { X_LINK_LENGTH, textLength } from "@/lib/social/text-length";
import type { SocialProvider } from "@/generated/prisma/enums";

/**
 * Social input validation.
 *
 * The interesting rule is the last one: a post is checked **against its
 * provider's declared capabilities**, not against a union of everything every
 * platform can do. A 400-character caption is fine on LinkedIn and impossible
 * on X, and the schema is the place that difference is enforced — so a post
 * that would be rejected at 7:30pm is rejected at the moment somebody writes
 * it (CLAUDE.md 2 rule 4).
 */

const PROVIDERS = [
  "INSTAGRAM",
  "FACEBOOK",
  "LINKEDIN",
  "YOUTUBE",
  "X",
  "GOOGLE_BUSINESS_PROFILE",
] as const;

const POST_TYPES = [
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
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

/**
 * A hashtag without its hash, or with one — stored without.
 *
 * Normalised here rather than at render time so two editors typing `#diwali`
 * and `diwali` do not produce two different tags on the same post.
 */
const hashtag = z
  .string()
  .trim()
  .transform((value) => value.replace(/^#+/, ""))
  .pipe(z.string().min(1).max(100).regex(/^[\p{L}\p{N}_]+$/u, "A hashtag cannot contain spaces or punctuation."));

export const socialPostSchema = z
  .object({
    contentItemId: z.string().min(1, "Choose the content item this belongs to."),
    accountId: z.string().trim().max(40).nullable().default(null),
    provider: z.enum(PROVIDERS),
    type: z.enum(POST_TYPES),
    caption: optionalText(10_000),
    headline: optionalText(300),
    hashtags: z.array(hashtag).max(30).default([]),
    mentions: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
    callToAction: optionalText(200),
    firstComment: optionalText(2_000),
    linkUrl: z
      .string()
      .trim()
      .url("Enter a full URL, including https://")
      .max(2_000)
      .nullable()
      .or(z.literal(""))
      .transform((value) => (value === "" ? null : value))
      .default(null),
    scheduledFor: z.coerce.date().nullable().default(null),
    mediaIds: z.array(z.string().min(1).max(40)).max(20).default([]),
  })
  .superRefine((value, ctx) => {
    const capabilities = CAPABILITIES[value.provider as SocialProvider];

    if (!(capabilities.postTypes as readonly string[]).includes(value.type)) {
      ctx.addIssue({
        code: "custom",
        path: ["type"],
        message: "That format is not supported for this account.",
      });
    }

    if (capabilities.captionLimit !== null && value.caption) {
      // Everything that rides in the text counts towards the limit: hashtags
      // on every provider with one, mentions where the platform takes them,
      // and the link where it sits in the post (X). A caption that fits until
      // the rest is added is a caption that fails at publication. Counted the
      // platform's way — see `textLength`.
      const extras = [
        ...value.hashtags.map((tag) => `#${tag}`),
        ...((capabilities.fields as readonly string[]).includes("mentions")
          ? value.mentions.map((m) => `@${m.replace(/^@+/, "")}`)
          : []),
        ...(capabilities.linkInText && value.linkUrl ? [value.linkUrl] : []),
      ];
      const composed = [value.caption, ...extras].join(" ");
      if (textLength(composed, capabilities.lengthRule) > capabilities.captionLimit) {
        ctx.addIssue({
          code: "custom",
          path: ["caption"],
          message:
            capabilities.lengthRule === "x-weighted"
              ? `Too long for X — ${capabilities.captionLimit} counting hashtags, mentions and the link (which X counts as ${X_LINK_LENGTH}); emoji count twice.`
              : `Too long for this platform — ${capabilities.captionLimit} characters including hashtags.`,
        });
      }
    }

    if (
      value.type === "CAROUSEL" &&
      capabilities.carouselLimit !== null &&
      value.mediaIds.length > capabilities.carouselLimit
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["mediaIds"],
        message: `At most ${capabilities.carouselLimit} items in a carousel on this platform.`,
      });
    }

    // A fixed set of buttons takes one of its own values, and most of them
    // open the post's link — a "Book" button with nowhere to go is refused.
    if (capabilities.callToActionOptions && value.callToAction) {
      const option = capabilities.callToActionOptions.find((o) => o.value === value.callToAction);
      if (!option) {
        ctx.addIssue({
          code: "custom",
          path: ["callToAction"],
          message: "Choose one of the listed buttons.",
        });
      } else if (option.needsLink && !value.linkUrl) {
        ctx.addIssue({
          code: "custom",
          path: ["linkUrl"],
          message: `The "${option.label}" button needs a link to open.`,
        });
      }
    }

    // A field the provider does not accept is refused rather than silently
    // dropped: an editor who wrote a call to action should be told it will not
    // appear, not discover it missing after publication.
    for (const [field, present] of [
      ["linkUrl", value.linkUrl !== null],
      ["callToAction", value.callToAction !== null],
      ["firstComment", value.firstComment !== null],
      ["headline", value.headline !== null],
    ] as const) {
      if (present && !(capabilities.fields as readonly string[]).includes(field)) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "This platform does not support that field.",
        });
      }
    }
  });

export type SocialPostInput = z.infer<typeof socialPostSchema>;

export const socialAccountConnectSchema = z.object({
  clientId: z.string().min(1).max(40),
  provider: z.enum(PROVIDERS),
});

export const socialPostListSchema = z.object({
  clientId: z.string().trim().max(40).nullable().default(null),
  provider: z.enum(PROVIDERS).nullable().default(null),
  status: z
    .enum(["DRAFT", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "CANCELLED"])
    .nullable()
    .default(null),
  campaignId: z.string().trim().max(40).nullable().default(null),
  from: z.coerce.date().nullable().default(null),
  to: z.coerce.date().nullable().default(null),
});

export type SocialPostListParams = z.infer<typeof socialPostListSchema>;

/**
 * The calendar's URL.
 *
 * Every piece of calendar state lives in the query string — the view, the
 * month, and each filter — so a planner can send somebody a link to exactly
 * what they are looking at, and so the back button steps through the months
 * they paged past.
 *
 * Every field falls back rather than failing. A calendar that answers a
 * mistyped `?view=grid` with an error page is worse than one that shows the
 * month; the URL is a bookmark somebody may have edited by hand, not a form.
 */

/** An enum filter that is absent, blank, or nonsense — all of which mean "all". */
const optionalEnum = <T extends string>(values: readonly [T, ...T[]]) =>
  z.enum(values).nullable().catch(null);

/** An id filter from the query string, blank meaning unset. */
const optionalIdParam = z
  .string()
  .trim()
  .max(40)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .catch(null);

export const socialCalendarParamsSchema = z.object({
  view: z.enum(["month", "week", "day", "list"]).catch("month"),
  /** `YYYY-MM` or `YYYY-MM-DD`; the grid reads it, and falls back to today. */
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}(-\d{2})?$/)
    .nullable()
    .catch(null)
    .default(null),
  provider: optionalEnum(PROVIDERS),
  type: optionalEnum(POST_TYPES),
  status: optionalEnum(["DRAFT", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED", "CANCELLED"]),
  stage: optionalEnum([
    "IDEA",
    "DRAFT",
    "INTERNAL_REVIEW",
    "CLIENT_REVIEW",
    "APPROVED",
    "SCHEDULED",
    "PUBLISHED",
  ]),
  campaignId: optionalIdParam,
  pillarId: optionalIdParam,
  projectId: optionalIdParam,
  ownerId: optionalIdParam,
});

export type SocialCalendarParams = z.infer<typeof socialCalendarParamsSchema>;
