import { z } from "zod";

/**
 * Tracking and pixel validation.
 *
 * Every provider's ID has a published format, and a typo in one is invisible
 * until someone notices a month of missing data. Validated server-side on save
 * (CLAUDE.md 2 rule 4) and reused client-side purely so the message arrives
 * before the round trip.
 *
 * An empty string means "not configured" and is always allowed — a provider is
 * turned off by clearing it or by its toggle, and neither should be an error.
 */

const blankToNull = (schema: z.ZodString) =>
  z
    .string()
    .trim()
    // Whitespace inside a pasted ID is a copy-paste artefact, never meaningful.
    .transform((value) => value.replace(/\s+/g, ""))
    .superRefine((value, ctx) => {
      if (value === "") return;
      const result = schema.safeParse(value);
      if (!result.success) {
        ctx.addIssue({
          code: "custom",
          message: result.error.issues[0]?.message ?? "That value is not valid.",
        });
      }
    })
    .transform((value) => (value === "" ? null : value))
    .optional()
    .transform((value) => value ?? null);

/** Google Tag Manager container, e.g. GTM-ABC1234. */
export const gtmId = blankToNull(
  z.string().regex(/^GTM-[A-Z0-9]+$/, "Use the container ID, e.g. GTM-ABC1234."),
);

/** GA4 measurement ID, e.g. G-AB12CD34EF. */
export const ga4Id = blankToNull(
  z.string().regex(/^G-[A-Z0-9]+$/, "Use the measurement ID, e.g. G-AB12CD34EF."),
);

/** Google Ads conversion ID, e.g. AW-123456789. */
export const googleAdsId = blankToNull(
  z.string().regex(/^AW-[A-Z0-9]+$/, "Use the conversion ID, e.g. AW-123456789."),
);

/**
 * Google Ads conversion label. Google does not publish a format; it is an
 * opaque token, so this bounds the characters rather than pretending to know
 * its shape.
 */
export const googleAdsLabel = blankToNull(
  z
    .string()
    .min(4)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "A conversion label is letters, digits, hyphens and underscores."),
);

/**
 * Google site verification: the `content` value only.
 *
 * Pasting the whole <meta> tag is the common mistake, so it is rejected with a
 * message that says what to paste instead rather than a format error.
 */
export const googleSiteVerification = blankToNull(
  z
    .string()
    .min(8)
    .max(128)
    .regex(
      /^[A-Za-z0-9_-]+$/,
      "Paste only the content value, not the whole <meta> tag.",
    ),
);

/** Meta pixel, 15–16 digits. */
export const metaPixelId = blankToNull(
  z.string().regex(/^\d{15,16}$/, "A Meta pixel ID is 15 or 16 digits."),
);

/** Microsoft Clarity project, lowercase letters and digits. */
export const clarityId = blankToNull(
  z.string().regex(/^[a-z0-9]{5,20}$/, "A Clarity project ID is lowercase letters and digits."),
);

/** Hotjar site ID, 6–9 digits. */
export const hotjarId = blankToNull(
  z.string().regex(/^\d{6,9}$/, "A Hotjar site ID is 6 to 9 digits."),
);

/** Pinterest tag, 13 digits. */
export const pinterestId = blankToNull(
  z.string().regex(/^\d{13}$/, "A Pinterest tag ID is 13 digits."),
);

/** TikTok pixel, 20 uppercase letters and digits. */
export const tiktokId = blankToNull(
  z.string().regex(/^[A-Z0-9]{20}$/, "A TikTok pixel ID is 20 uppercase letters and digits."),
);

/** Snap pixel, a UUID. */
export const snapchatId = blankToNull(
  z
    .string()
    .regex(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      "A Snap pixel ID is a UUID.",
    ),
);

export const consentMode = z.enum(["IMPLIED", "OPT_IN", "OPT_OUT"]);
export type ConsentMode = z.infer<typeof consentMode>;

const toggle = z.boolean().default(false);

/**
 * The whole settings form.
 *
 * One schema rather than one per card: the form saves as a unit, and a
 * cross-field rule (a conversion label needs a conversion ID) cannot be
 * expressed if each card validates alone.
 */
export const trackingSettingsSchema = z
  .object({
    gtmEnabled: toggle,
    gtmId,

    ga4Enabled: toggle,
    ga4Id,

    googleAdsEnabled: toggle,
    googleAdsId,
    googleAdsLabelEnabled: toggle,
    googleAdsLabel,

    googleSiteVerificationEnabled: toggle,
    googleSiteVerification,

    metaPixelEnabled: toggle,
    metaPixelId,

    clarityEnabled: toggle,
    clarityId,

    hotjarEnabled: toggle,
    hotjarId,

    pinterestEnabled: toggle,
    pinterestId,

    tiktokEnabled: toggle,
    tiktokId,

    snapchatEnabled: toggle,
    snapchatId,

    consentMode: consentMode.default("IMPLIED"),
    consentBannerText: z
      .string()
      .trim()
      .max(600)
      .optional()
      .transform((value) => (value ? value : null)),

    capiPurchasesEnabled: toggle,
  })
  .superRefine((value, ctx) => {
    // A conversion label without an ID is inert — it identifies a conversion
    // action within an account that has not been named.
    if (value.googleAdsLabelEnabled && !value.googleAdsId) {
      ctx.addIssue({
        code: "custom",
        path: ["googleAdsLabel"],
        message: "Add a Google Ads conversion ID before using a label.",
      });
    }
    // Turning a provider on with nothing to send is a configuration mistake,
    // not a silent no-op.
    const pairs: [boolean, string | null, string][] = [
      [value.gtmEnabled, value.gtmId, "gtmId"],
      [value.ga4Enabled, value.ga4Id, "ga4Id"],
      [value.googleAdsEnabled, value.googleAdsId, "googleAdsId"],
      [value.googleSiteVerificationEnabled, value.googleSiteVerification, "googleSiteVerification"],
      [value.metaPixelEnabled, value.metaPixelId, "metaPixelId"],
      [value.clarityEnabled, value.clarityId, "clarityId"],
      [value.hotjarEnabled, value.hotjarId, "hotjarId"],
      [value.pinterestEnabled, value.pinterestId, "pinterestId"],
      [value.tiktokEnabled, value.tiktokId, "tiktokId"],
      [value.snapchatEnabled, value.snapchatId, "snapchatId"],
    ];
    for (const [enabled, id, path] of pairs) {
      if (enabled && !id) {
        ctx.addIssue({ code: "custom", path: [path], message: "Add an ID before turning this on." });
      }
    }
  });

export type TrackingSettingsInput = z.infer<typeof trackingSettingsSchema>;

/**
 * The Meta Conversions API token, saved on its own.
 *
 * Separate from the settings form so the secret is never a hidden field in a
 * form that is posted every time someone edits an unrelated toggle.
 */
export const capiTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20, "That does not look like a Conversions API access token.")
    .max(512),
});
export type CapiTokenInput = z.infer<typeof capiTokenSchema>;
